#!/usr/bin/env nodejs

'use strict';

const crypto = require('crypto');
const http = require('http');
const ws = require('ws');

// Generate a new RSA key pair
// 生成一个新的 RSA 密钥对
const generateRSAKeyPair = () => {
	try {
		console.log('Generating new RSA keypair...');
		const {
			publicKey,
			privateKey
		} = crypto.generateKeyPairSync('rsa', {
			modulusLength: 2048,
			publicKeyEncoding: {
				type: 'spki',
				format: 'der'
			},
			privateKeyEncoding: {
				type: 'pkcs8',
				format: 'der'
			}
		});

		return {
			rsaPublic: Buffer.from(publicKey).toString('base64'),
			rsaPrivate: crypto.createPrivateKey({
				key: privateKey,
				format: 'der',
				type: 'pkcs8'
			})
		};
	} catch (error) {
		console.error('Error generating RSA key pair:', error);
		process.exit(1);
	}
};

const keyPair = generateRSAKeyPair();
console.log('RSA key pair generated successfully');

const config = {
	rsaPrivate: keyPair.rsaPrivate,
	rsaPublic: keyPair.rsaPublic,
	// Env override for tests / co-hosted instances (S-1 testability);
	// defaults unchanged. 反代后 remoteAddress 恒为代理 IP，见部署文档。
	wsHost: process.env.HOST || '127.0.0.1',
	wsPort: Number(process.env.PORT) || 8088,
	seenTimeout: 60000,
	debug: false
};

// ---- S-1/S-2 rate limits (PR-4). Same values and semantics as
// worker/ratelimit.js — keep the two in sync. Derivations: legal file
// sending peaks at 50 frames/s (client/js/util.file.js batches), so the
// bucket refills at 60/s with capacity 120; byte window 350MB / 10 min
// per connection; fanout 64; channel members 200; handshakes: a legal
// client handshakes exactly once per connection. Only frame length and
// frequency metadata is counted, never payload (RULES 1); counters are
// in-memory only (RULES 4). ----
const RL = {
	maxFrameBytes: 8 * 1024 * 1024,
	bucketCapacity: 120,
	refillPerSec: 60,
	maxViolations: 3,
	byteWindowMs: 10 * 60 * 1000,
	byteWindowMax: 350 * 1024 * 1024,
	maxFanout: 64,
	maxChannelMembers: 200,
	maxConnectionsGlobal: 1000,
	maxConnectionsPerIp: 100,
	maxHandshakesPerConnection: 3,
	maxHandshakesPerIp: 10,
	handshakeWindowMs: 60 * 1000,
	ipMapMaxEntries: 10000
};
const HANDSHAKE_FRAME_RE = /^04[0-9a-fA-F]{192}$/;
const hsIpMap = new Map(); // ip -> {count, resetAt}
const rlBucketAllow = (state, now) => {
	const elapsedSec = Math.max(0, (now - state.last) / 1000);
	state.tokens = Math.min(RL.bucketCapacity, state.tokens + elapsedSec * RL.refillPerSec);
	state.last = now;
	if (state.tokens >= 1) {
		state.tokens -= 1;
		return { allow: true, shouldClose: false };
	}
	state.violations += 1;
	return { allow: false, shouldClose: state.violations >= RL.maxViolations };
};
const rlByteWindowAllow = (state, length, now) => {
	if (now - state.start > RL.byteWindowMs) {
		state.start = now;
		state.bytes = 0;
	}
	state.bytes += length;
	return state.bytes <= RL.byteWindowMax;
};
const rlIpHandshakeAllow = (ip, now) => {
	if (hsIpMap.size > RL.ipMapMaxEntries) {
		for (const [k, v] of hsIpMap) if (v.resetAt <= now) hsIpMap.delete(k);
		if (hsIpMap.size > RL.ipMapMaxEntries) hsIpMap.clear();
	}
	let rec = hsIpMap.get(ip);
	if (!rec || rec.resetAt <= now) {
		rec = { count: 0, resetAt: now + RL.handshakeWindowMs };
		hsIpMap.set(ip, rec);
	}
	rec.count += 1;
	return rec.count <= RL.maxHandshakesPerIp;
};
const rlIpHandshakeCount = (ip, now) => {
	const rec = hsIpMap.get(ip);
	if (!rec || rec.resetAt <= now) return 0;
	return rec.count;
};


// Item 32: plain-HTTP front door for the ws server, solely so Docker /
// orchestrators can probe liveness. /healthz returns the bare string
// "ok" with status 200 — no version, no counts, no keys, no channel or
// client metadata of any kind (RULES 1/9). Every other path is a bare
// 404. WebSocket upgrades bypass this handler via the ws server below.
// 仅供 Docker/编排探活的 HTTP 入口：/healthz 只回 200 + "ok"，
// 不带任何业务元数据；其余路径一律空 404。
const httpServer = http.createServer((req, res) => {
	const urlPath = (req.url || '').split('?')[0];
	if (req.method === 'GET' && urlPath === '/healthz') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('ok');
		return;
	}
	res.writeHead(404, { 'Content-Type': 'text/plain' });
	res.end();
});

const wss = new ws.Server({
	server: httpServer,
	perMessageDeflate: false,
	// S-1: the only limit enforced before a full frame lands in memory.
	maxPayload: RL.maxFrameBytes,
	// S-2: once an IP has burned its handshake window, refuse upgrades
	// with 429 before any per-connection work happens.
	verifyClient: (info, cb) => {
		const ip = (info.req && info.req.socket && info.req.socket.remoteAddress) || 'unknown';
		if (rlIpHandshakeCount(ip, Date.now()) >= RL.maxHandshakesPerIp) {
			cb(false, 429, 'Too Many Requests');
			return;
		}
		cb(true);
	}
});

httpServer.listen(config.wsPort, config.wsHost, () => {
	console.log('server started', config.wsHost, config.wsPort);
});


var clients = {};
var channels = {};

// Remove a client exactly once: detach from its channel, delete an emptied
// channel, broadcast the updated member list to the rest, drop the record.
// Idempotent — the close handler and the stale-connection sweep share this
// path (S-5 parity fix), and a terminated connection's later close event
// must find nothing left to do instead of throwing.
// 幂等摘除：摘频道、删空频道、向剩余成员广播新列表、删记录。close 处理器
// 与过期清理共用此路径，被 terminate 的连接随后触发 close 时直接返回。
const removeClient = (clientId) => {
	const record = clients[clientId];
	if (!record) {
		return;
	}

	const channel = record.channel;

	if (
		channel &&
		channels[channel]
	) {

		channels[channel].splice(channels[channel].indexOf(clientId), 1);

		if (
			channels[channel].length === 0
		) {

			delete(channels[channel]);

		} else {

			try {

				const members = channels[channel];

				for (
					const member of members
				) {

					const client = clients[member];

					if (
						isClientInChannel(client, channel)
					) {
						sendMessage(client.connection, encryptMessage({
							a: 'l',
							p: members.filter((value) => {
								return (
									value !== member ?
									true :
									false
								);
							})
						}, client.shared));
					}

				}

			} catch (error) {
				logEvent('close-list', [clientId, error], 'error');
			}

		}

	}

	delete(clients[clientId]);
};

// WebSocket server connection event handler
// WebSocket 服务器连接事件处理程序
wss.on('connection', (connection, req) => {

	if (
		!connection
	) {
		return;
	}


	const seenThreshold = (getTime() - config.seenTimeout);

	// Collect first, then terminate + removeClient (S-5): mutating `clients`
	// while iterating it skips entries, and terminating alone used to leave
	// stale records and dead channel members behind.
	// 先收集再逐个 terminate + removeClient，避免迭代中改对象漏删、记录残留。
	const staleClientIds = [];

	for (
		const clientId in clients
	) {
		if (
			clients[clientId].seen < seenThreshold
		) {
			staleClientIds.push(clientId);
		}
	}

	for (
		const staleId of staleClientIds
	) {
		try {
			logEvent('connection-seen', staleId, 'debug');
			clients[staleId].connection.terminate();
		} catch (error) {
			logEvent('connection-seen', error, 'error');
		}
		removeClient(staleId);
	}


	const clientId = generateClientId();

	if (
		!clientId ||
		clients[clientId]
	) {
		closeConnection(connection);
		return;
	}

	// S-1 connection caps: global and per-IP. NOTE: behind the Docker
	// nginx proxy remoteAddress is the proxy IP, so the per-IP cap can
	// throttle a whole NAT/proxy — raise it for >100-user single-egress
	// deployments (see deployment docs). X-Forwarded-For is not trusted.
	const connIp = (req && req.socket && req.socket.remoteAddress) || 'unknown';
	let sameIpCount = 0;
	for (
		const otherId in clients
	) {
		if (clients[otherId].ip === connIp) sameIpCount++;
	}
	if (
		Object.keys(clients).length >= RL.maxConnectionsGlobal ||
		sameIpCount >= RL.maxConnectionsPerIp
	) {
		closeConnection(connection);
		return;
	}

	logEvent('connection', clientId, 'debug');


	clients[clientId] = {
		connection: connection,
		seen: getTime(),
		key: null,
		channel: null,
		// S-1/S-2 guards (in-memory only, die with the connection)
		ip: connIp,
		bucket: { tokens: RL.bucketCapacity, last: Date.now(), violations: 0 },
		byteWin: { start: Date.now(), bytes: 0 },
		hsAttempts: 0
	};

	try {
		logEvent('sending-public-key', clientId, 'debug');
		sendMessage(connection, JSON.stringify({
			type: 'server-key',
			key: config.rsaPublic
		}));
	} catch (error) {
		logEvent('sending-public-key', error, 'error');
	}



	connection.on('message', (data, isBinary) => {

		// ws >= 8 delivers text frames as Buffer (ws 7 gave strings). Convert
		// once at the door so every check below keeps its string semantics.
		// ws 8 起文本帧以 Buffer 传入，进门统一转字符串，下游逻辑不变（K-2）。
		const message = isBinary ? '' : data.toString();

		if (
			!isString(message) ||
			!clients[clientId]
		) {
			return;
		}

		clients[clientId].seen = getTime();

		// S-1 connection guards (same semantics as worker/ratelimit.js):
		// token bucket + rolling byte window, metadata only (RULES 1).
		const rlRec = clients[clientId];
		const rlVerdict = rlBucketAllow(rlRec.bucket, Date.now());
		if (!rlVerdict.allow) {
			if (rlVerdict.shouldClose) connection.close(1008);
			return;
		}
		if (!rlByteWindowAllow(rlRec.byteWin, message.length, Date.now())) {
			connection.close(1008);
			return;
		}

		if (
			message === 'ping'
		) {
			sendMessage(connection, 'pong');
			return;
		}

		logEvent('message', clientId, 'debug'); // SECURITY: never log raw message content

		// S-2: handshake-shaped frame on an established connection is
		// dropped; the handshake branch is unreachable once shared exists.
		if (
			clients[clientId].shared &&
			HANDSHAKE_FRAME_RE.test(message)
		) {
			return;
		}

		if (
			!clients[clientId].shared &&
			message.length < 2048
		) {

			// S-2 cheap pre-checks before any cryptographic work: exact
			// frame shape, per-connection attempts, per-IP window.
			if (!HANDSHAKE_FRAME_RE.test(message)) {
				closeConnection(connection);
				return;
			}
			clients[clientId].hsAttempts++;
			if (clients[clientId].hsAttempts > RL.maxHandshakesPerConnection) {
				closeConnection(connection);
				return;
			}
			if (!rlIpHandshakeAllow(clients[clientId].ip, Date.now())) {
				closeConnection(connection);
				return;
			}

			try {

				const keys = crypto.createECDH('secp384r1');

				keys.generateKeys();

				const publicKey = keys.getPublicKey();
				const signature = crypto.sign('sha256', publicKey, {
					key: config.rsaPrivate,
					padding: crypto.constants.RSA_PKCS1_PADDING,
					dsaEncoding: 'ieee-p1363'
				});

				clients[clientId].shared = keys.computeSecret(message, 'hex', null).slice(8, 40);

				sendMessage(connection, publicKey.toString('hex') + '|' + signature.toString('base64'));

			} catch (error) {
				logEvent('message-key', [clientId, error], 'error');
				closeConnection(connection);
			}

			return;

		}

		if (
			clients[clientId].shared &&
			message.length <= (8 * 1024 * 1024)
		) {

			processEncryptedMessage(clientId, message);

		}

	});



	connection.on('error', (error) => {

		// ws emits 'error' for receiver failures — including the S-1
		// maxPayload kill (1009). Without a listener Node treats it as an
		// unhandled 'error' event and the whole process dies with the
		// connection. Log the type only; cleanup runs via 'close'.
		// maxPayload 等接收错误会以 'error' 事件抛出，无监听会拖垮进程；
		// 这里只吞掉并记类型，清理走 close 路径。
		logEvent('connection-error', [clientId, error && error.code], 'error');

	});

	connection.on('close', (event) => {

		logEvent('close', [clientId, event], 'debug');

		// S-5: shared idempotent removal. The record may already be gone
		// (stale sweep terminated this connection first) — removeClient
		// returns quietly instead of dereferencing a missing record.
		// 与过期清理共用幂等摘除；记录已删时静默返回，不再未判空抛错。
		removeClient(clientId);

	});

});

// Process encrypted messages
// 处理加密消息
const processEncryptedMessage = (clientId, message) => {
	let decrypted = null;

	try {
		decrypted = decryptMessage(message, clients[clientId].shared);

		logEvent('message-decrypted', [clientId, decrypted.a], 'debug'); // SECURITY: action type only, never payload

		if (
			!isObject(decrypted) ||
			!isString(decrypted.a)
		) {
			return;
		}

		const action = decrypted.a;

		if (action === 'j') {
			handleJoinChannel(clientId, decrypted);
		} else if (action === 'c') {
			handleClientMessage(clientId, decrypted);
		} else if (action === 'w') {
			handleChannelMessage(clientId, decrypted);
		}

	} catch (error) {
		logEvent('process-encrypted-message', [clientId, error], 'error');
	} finally {
		decrypted = null;
	}
};

// Handle channel join requests
// 处理加入频道请求
const handleJoinChannel = (clientId, decrypted) => {
	if (
		!isString(decrypted.p) ||
		clients[clientId].channel
	) {
		return;
	}

	// R4 parity (mirrors worker/index.js handleJoinChannel): the client
	// always joins with the sha256 hex hash of the room name. Enforce that
	// format so arbitrary strings cannot become channel names.
	// 与 Worker 逐字对齐：频道名强制为房间名的 sha256 十六进制哈希。
	if (!/^[0-9a-f]{64}$/.test(decrypted.p)) {
		logEvent('message-join', [clientId, 'invalid channel format'], 'error');
		return;
	}

	// S-1: channel member cap (silent refuse, parity with worker).
	if (
		channels[decrypted.p] &&
		channels[decrypted.p].length >= RL.maxChannelMembers
	) {
		logEvent('message-join', [clientId, 'channel full'], 'error');
		return;
	}

	try {
		const channel = decrypted.p;

		clients[clientId].channel = channel;

		if (!channels[channel]) {
			channels[channel] = [clientId];
		} else {
			channels[channel].push(clientId);
		}

		broadcastMemberList(channel);

	} catch (error) {
		logEvent('message-join', [clientId, error], 'error');
	}
};

// Handle client messages
// 处理客户端消息
const handleClientMessage = (clientId, decrypted) => {
	if (
		!isString(decrypted.p) ||
		!isString(decrypted.c) ||
		!clients[clientId].channel
	) {
		return;
	}

	try {
		const channel = clients[clientId].channel;
		const targetClient = clients[decrypted.c];

		if (isClientInChannel(targetClient, channel)) {
			const messageObj = {
				a: 'c',
				p: decrypted.p,
				c: clientId
			};

			const encrypted = encryptMessage(messageObj, targetClient.shared);
			sendMessage(targetClient.connection, encrypted);

			messageObj.p = null;
		}

	} catch (error) {
		logEvent('message-client', [clientId, error], 'error');
	}
};

// Handle channel messages
// 处理频道消息
const handleChannelMessage = (clientId, decrypted) => {
	if (
		!isObject(decrypted.p) ||
		!clients[clientId].channel
	) {
		return;
	}

	try {
		const channel = clients[clientId].channel;

		// S-1: fanout cap — at most RL.maxFanout recipients per frame.
		let fanout = 0;

		for (const member in decrypted.p) {
			if (fanout >= RL.maxFanout) break;
			const targetClient = clients[member];

			if (
				isString(decrypted.p[member]) &&
				isClientInChannel(targetClient, channel)
			) {
				fanout++;
				const messageObj = {
					a: 'c',
					p: decrypted.p[member],
					c: clientId
				};

				const encrypted = encryptMessage(messageObj, targetClient.shared);
				sendMessage(targetClient.connection, encrypted, { critical: false }); // #28: fanout is droppable under backpressure

				messageObj.p = null;
			}
		}

	} catch (error) {
		logEvent('message-channel', [clientId, error], 'error');
	}
};

// Broadcast member list to channel
// 向频道广播成员列表
const broadcastMemberList = (channel) => {
	try {
		const members = channels[channel];

		for (const member of members) {
			const client = clients[member];

			if (isClientInChannel(client, channel)) {
				const filteredMembers = members.filter(value => value !== member);

				const listObj = {
					a: 'l',
					p: filteredMembers
				};

				const encrypted = encryptMessage(listObj, client.shared);
				sendMessage(client.connection, encrypted, { critical: false }); // #28: re-broadcast on next change

				listObj.p = null;
			}
		}
	} catch (error) {
		logEvent('broadcast-member-list', error, 'error');
	}
};



// Log events with timestamps and levels
// 记录带时间戳和级别的事件
const logEvent = (source, message, level) => {
	if (
		level !== 'debug' ||
		config.debug
	) {

		const date = new Date(),
			dateString = date.getFullYear() + '-' +
			('0' + (date.getMonth() + 1)).slice(-2) + '-' +
			('0' + date.getDate()).slice(-2) + ' ' +
			('0' + date.getHours()).slice(-2) + ':' +
			('0' + date.getMinutes()).slice(-2) + ':' +
			('0' + date.getSeconds()).slice(-2);

		console.log('[' + dateString + ']', (level ? level.toUpperCase() : 'INFO'), source + (message ? ':' : ''), (message ? message : ''));

	}
};


const generateClientId = () => {
	try {
		return (crypto.randomBytes(8).toString('hex'));
	} catch (error) {
		logEvent('generateClientId', error, 'error');
		return (null);
	}
};


const closeConnection = (connection) => {
	try {
		connection.close();
	} catch (error) {
		logEvent('closeConnection', error, 'error');
	}
};


const isClientInChannel = (client, channel) => {
	return (
		client &&
		client.connection &&
		client.shared &&
		client.channel &&
		client.channel === channel ?
		true :
		false
	);
};


// ---- #28: fanout backpressure (Node path only) ----
// sendMessage used to check only readyState: a slow/dead member's outbound
// queue (ws bufferedAmount) grew without bound, fed by ~470KB file frames.
// Threshold derivation (deliberately conservative, do not lower casually):
// - SOFT = 8MB = exactly one maximum-size frame. A healthy client that is
//   actively draining can transiently hold one full frame in flight, so
//   nothing is ever dropped at or below one frame's worth of backlog.
// - Above SOFT, only NON-critical frames are dropped (channel fanout and
//   member-list broadcasts — both self-healing: fanout content is covered
//   by peer replay after reconnect, member lists re-broadcast on change).
//   Unicast (private messages, sync replay) and handshake frames are
//   critical and are never dropped by this mechanism.
// - SUSTAIN = 20s above SOFT before closing: even a very slow 512KB/s
//   reader drains >10MB in 20s, so a queue still above 8MB after 20s is a
//   dead reader, not a slow-but-normal user. Close code 1013 (try again
//   later); the client reconnects with backoff (#13) + peer replay (#30).
// Worker path: Cloudflare WebSockets expose no bufferedAmount, so the
// Worker implements only the fanout yield (see worker/index.js #28) —
// this asymmetry is declared in the README dual-path differences table
// (RULES invariant 9).
// ---- #28：扇出背压（仅 Node 路径）----
// 推导见上：SOFT=8MB 恰为一帧上限，正常排空的客户端在途至多一帧，
// 故一帧以内绝不丢；超 SOFT 只丢非关键帧（频道扇出/成员列表，均可
// 自愈）；持续超 20s 判定为死读者（512KB/s 的慢读者 20s 也能排空
// >10MB），以 1013 断开，客户端退避重连 + 同伴重播兜底。
const BP_SOFT_BYTES = 8 * 1024 * 1024;
const BP_SUSTAIN_MS = 20000;

// Pure decision function (exported for tests). Returns the action plus the
// updated overSince timestamp the caller must persist per connection.
const backpressureAction = (bufferedAmount, overSince, now, isCritical) => {
	const amt = (typeof bufferedAmount === 'number' && bufferedAmount > 0) ? bufferedAmount : 0;
	if (amt <= BP_SOFT_BYTES) return { action: 'send', overSince: 0 };
	const since = overSince || now;
	if (now - since >= BP_SUSTAIN_MS) return { action: 'close', overSince: since };
	if (!isCritical) return { action: 'drop', overSince: since };
	return { action: 'send', overSince: since };
};

const sendMessage = (connection, message, options) => {
	try {
		if (
			connection.readyState &&
			connection.readyState === ws.OPEN
		) {
			// #28: consult the backpressure gate before queueing more data.
			const isCritical = !options || options.critical !== false;
			const bp = backpressureAction(connection.bufferedAmount, connection._bpOverSince || 0, Date.now(), isCritical);
			connection._bpOverSince = bp.overSince;
			if (bp.action === 'drop') {
				connection._bpDropped = (connection._bpDropped || 0) + 1;
				return;
			}
			if (bp.action === 'close') {
				logEvent('sendMessage-backpressure', 'closing sustained-over-threshold connection', 'error');
				try { connection.close(1013); } catch (_e) { /* already gone */ }
				return;
			}
			connection.send(message);
		}
	} catch (error) {
		logEvent('sendMessage', error, 'error');
	}
};


const encryptMessage = (message, key) => {

	let encrypted = '';

	try {

		const messageBuffer = Buffer.from(JSON.stringify(message), 'utf8');

		// AES-256-GCM (authenticated encryption). Wire format:
		//   base64(12B iv) | base64(ciphertext || 16B auth tag)
		// Compatible with @stablelib/gcm / WebCrypto AES-GCM on the client.
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
		const ciphertext = Buffer.concat([cipher.update(messageBuffer), cipher.final()]);
		const tag = cipher.getAuthTag();

		encrypted = iv.toString('base64') + '|' + Buffer.concat([ciphertext, tag]).toString('base64');

	} catch (error) {
		logEvent('encryptMessage', error, 'error');
	}

	return (encrypted);

};


const decryptMessage = (message, key) => {

	let decrypted = {};

	try {

		const parts = message.split('|');
		const sealed = Buffer.from(parts[1], 'base64');
		const tag = sealed.subarray(sealed.length - 16);
		const ciphertext = sealed.subarray(0, sealed.length - 16);

		const decipher = crypto.createDecipheriv(
			'aes-256-gcm',
			key,
			Buffer.from(parts[0], 'base64')
		);
		decipher.setAuthTag(tag);

		const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
		decrypted = JSON.parse(plain);

	} catch (error) {
		// Auth failure (tampering) lands here and yields an empty object.
		logEvent('decryptMessage', error, 'error');
	}

	return (decrypted);

};


const getTime = () => {
	return (new Date().getTime());
};


const isString = (value) => {
	return (
		value &&
		Object.prototype.toString.call(value) === '[object String]' ?
		true :
		false
	);
};


const isObject = (value) => {
	return (
		value &&
		Object.prototype.toString.call(value) === '[object Object]' ?
		true :
		false
	);
};

setInterval(() => {
	if (global.gc) {
		global.gc();
	}
}, 30000);
// #28: test hooks — the pure backpressure decision, exported without
// changing runtime behaviour (the server above starts as usual).
if (typeof module !== 'undefined' && module.exports) {
	module.exports.backpressureAction = backpressureAction;
	module.exports.BP_SOFT_BYTES = BP_SOFT_BYTES;
	module.exports.BP_SUSTAIN_MS = BP_SUSTAIN_MS;
}

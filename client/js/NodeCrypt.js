// NodeCrypt core cryptographic client for secure chat
// NodeCrypt 安全聊天的核心加密客户端

import {
	sha256
} from 'js-sha256';
import {
	ec as elliptic
} from 'elliptic';
import {
	AES
} from '@stablelib/aes';
import {
	GCM
} from '@stablelib/gcm';
import {
	ChaCha20Poly1305
} from '@stablelib/chacha20poly1305';
import {
	Buffer
} from 'buffer';
window.Buffer = Buffer;

// Main NodeCrypt class for secure communication
// 用于安全通信的 NodeCrypt 主类
class NodeCrypt {
	// Initialize NodeCrypt instance
	// 初始化 NodeCrypt 实例
	constructor(config = {}, callbacks = {}) {
		this.config = {
			rsaPublic: config.rsaPublic || '',
			// SECURITY: when a server key is explicitly configured (e.g. from the
			// deployment), it is pinned and any mismatch aborts the connection.
			rsaPublicFixed: !!config.rsaPublic,
			wsAddress: config.wsAddress || '',
			reconnectDelay: config.reconnectDelay || 3000,
			pingInterval: config.pingInterval || 20000,
			debug: config.debug || false,
		};
		this.callbacks = {
			onServerClosed: callbacks.onServerClosed || null,
			onServerSecured: callbacks.onServerSecured || null,
			onClientSecured: callbacks.onClientSecured || null,
			onClientList: callbacks.onClientList || null,
			onClientMessage: callbacks.onClientMessage || null,
			onClientReaction: callbacks.onClientReaction || null,
			onClientTyping: callbacks.onClientTyping || null,
			onClientEdit: callbacks.onClientEdit || null,
			onClientDelete: callbacks.onClientDelete || null,
			onClientReadReceipt: callbacks.onClientReadReceipt || null,
			onClientSync: callbacks.onClientSync || null,
			onClientReplay: callbacks.onClientReplay || null,
			onClientStatus: callbacks.onClientStatus || null
		};
		try {
			this.clientEc = new elliptic('curve25519')
		} catch (error) {
			this.logEvent('constructor', error, 'error')
		}
		this.serverKeys = null;
		this.serverShared = null;
		this.credentials = null;
		this.connection = null;
		this.reconnect = null;
		this.ping = null;
		this.channel = {};
		this.setCredentials = this.setCredentials.bind(this);
		this.connect = this.connect.bind(this);
		this.destruct = this.destruct.bind(this);
		this.onOpen = this.onOpen.bind(this);
		this.onMessage = this.onMessage.bind(this);
		this.onError = this.onError.bind(this);
		this.onClose = this.onClose.bind(this);
		this.logEvent = this.logEvent.bind(this);
		this.isOpen = this.isOpen.bind(this);
		this.isClosed = this.isClosed.bind(this);
		this.startReconnect = this.startReconnect.bind(this);
		this.stopReconnect = this.stopReconnect.bind(this);
		this.startPing = this.startPing.bind(this);
		this.stopPing = this.stopPing.bind(this);
		this.disconnect = this.disconnect.bind(this);
		this.sendMessage = this.sendMessage.bind(this);
		this.sendChannelMessage = this.sendChannelMessage.bind(this);
		this.encryptServerMessage = this.encryptServerMessage.bind(this);
		this.decryptServerMessage = this.decryptServerMessage.bind(this);
		this.encryptClientMessage = this.encryptClientMessage.bind(this);
		this.decryptClientMessage = this.decryptClientMessage.bind(this)
	}

	// Set user credentials (username, channel, password)
	// 设置用户凭证（用户名、频道、密码）
	async setCredentials(username, channel, password) {
		this.logEvent('setCredentials');
		try {
			// SECURITY: the room password is stretched with PBKDF2-SHA256 (200k
			// iterations, native WebCrypto) before participating in key derivation,
			// so weak passwords are far more expensive to brute-force. The salt
			// binds the derivation to the room name and needs no server-side storage.
			const encoder = new TextEncoder();
			const baseKey = await crypto.subtle.importKey(
				'raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
			const salt = encoder.encode('nodecrypt:v2:' + channel);
			const bits = await crypto.subtle.deriveBits(
				{ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
				baseKey, 256);
			const stretchedHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
			this.credentials = {
				username: username,
				channel: sha256(channel),
				password: stretchedHex
			}
			return (true)
		} catch (error) {
			this.logEvent('setCredentials', error, 'error');
			return (false)
		}
	}

	// Connect to the server
	// 连接到服务器
	connect() {
		if (!this.credentials) {
			return (false)
		}
		this.logEvent('connect', this.config.wsAddress);
		this.stopReconnect();
		this.stopPing();
		this.serverKeys = null;
		this.serverShared = null;
		this.channel = {};
		try {
			// Route the WebSocket to the per-room Durable Object. The channel
			// value is the client-side sha256 hex digest of the room name —
			// appending it here lets the worker shard rooms without ever
			// learning the room name itself.
			let wsUrl = this.config.wsAddress;
			if (this.credentials && this.credentials.channel) {
				wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'c=' + this.credentials.channel;
			}
			this.connection = new WebSocket(wsUrl);
			this.connection.onopen = this.onOpen;
			this.connection.onmessage = this.onMessage;
			this.connection.onerror = this.onError;
			this.connection.onclose = this.onClose
		} catch (error) {
			this.logEvent('connect', error, 'error');
			return (false)
		}
		return (true)
	}

	// Clean up and disconnect
	// 清理并断开连接
	destruct() {
		this.logEvent('destruct');
		this.stopReconnect();
		this.stopPing();
		this.reconnect = null;
		this.ping = null;
		this.config = {
			rsaPublic: '',
			wsAddress: '',
			reconnectDelay: 3000,
			pingInterval: 15000,
			debug: false,
		};
		this.callbacks.onServerClosed = null;
		this.callbacks.onServerSecured = null;
		this.callbacks.onClientSecured = null;
		this.callbacks.onClientList = null;
		this.callbacks.onClientMessage = null;
		this.clientEc = null;
		this.serverKeys = null;
		this.serverShared = null;
		this.credentials = null;
		this.connection.onopen = null;
		this.connection.onmessage = null;
		this.connection.onerror = null;
		this.connection.onclose = null;
		try {
			// R4 fix (review 4f): browser WebSocket has no removeAllListeners;
			// only call it when the runtime actually provides it.
			if (typeof this.connection.removeAllListeners === 'function') {
				this.connection.removeAllListeners()
			}
		} catch (error) {
			this.logEvent('destruct', error, 'error')
		}
		try {
			this.connection.close()
		} catch (error) {
			this.logEvent('destruct', error, 'error')
		}
		this.connection = null;
		this.channel = {};
		return (true)
	}

	// WebSocket open event handler
	// WebSocket 连接打开事件处理
	async onOpen() {
		this.logEvent('onOpen');
		this.startPing();
		try {
			this.serverKeys = await crypto.subtle.generateKey({
				name: 'ECDH',
				namedCurve: 'P-384'
			}, false, ['deriveKey', 'deriveBits']);
			this.serverShared = null;
			this.sendMessage(Buffer.from(await crypto.subtle.exportKey('raw', this.serverKeys.publicKey)).toString('hex'))
		} catch (error) {
			this.logEvent('onOpen', error, 'error')
		}
	}

	// WebSocket message event handler
	// WebSocket 消息事件处理
	async onMessage(event) {
		if (!event || !this.isString(event.data)) {
			return
		}
		if (event.data === 'pong') {
			return
		}
		this.logEvent('onMessage', event.data);
		try {
			const data = JSON.parse(event.data);
			if (data.type === 'server-key') {
				const result = await this.handleServerKey(data);
				if (!result) {
					return
				}
			}
		} catch (e) {}
		if (!this.serverShared) {
			const parts = event.data.split('|');
			if (!parts[0] || !parts[1]) {
				return
			}
			try {
				if (await crypto.subtle.verify({
						name: 'RSASSA-PKCS1-v1_5'
					}, await crypto.subtle.importKey('spki', Buffer.from(this.config.rsaPublic, 'base64'), {
						name: 'RSASSA-PKCS1-v1_5',
						hash: {
							name: 'SHA-256'
						}
					}, false, ['verify']), Buffer.from(parts[1], 'base64'), Buffer.from(parts[0], 'hex')) === true) {
					this.serverShared = Buffer.from(await crypto.subtle.deriveBits({
						name: 'ECDH',
						namedCurve: 'P-384',
						public: await crypto.subtle.importKey('raw', Buffer.from(parts[0], 'hex'), {
							name: 'ECDH',
							namedCurve: 'P-384'
						}, true, [])
					}, this.serverKeys.privateKey, 384)).slice(8, 40);
					this.sendMessage(this.encryptServerMessage({
						a: 'j',
						p: this.credentials.channel
					}, this.serverShared));
					if (this.callbacks.onServerSecured) {
						try {
							this.callbacks.onServerSecured()
						} catch (error) {
							this.logEvent('onMessage-server-secured-callback', error, 'error')
						}
					}
				}
			} catch (error) {
				this.logEvent('onMessage', error, 'error')
			}
			return
		}
		const serverDecrypted = this.decryptServerMessage(event.data, this.serverShared);
		// SECURITY: log only the action type, never the payload
		this.logEvent('onMessage-server-decrypted', serverDecrypted.a);
		if (!this.isObject(serverDecrypted) || !this.isString(serverDecrypted.a)) {
			return
		}
		if (serverDecrypted.a === 'l' && this.isArray(serverDecrypted.p)) {
			try {
				for (const clientId in this.channel) {
					if (serverDecrypted.p.indexOf(clientId) < 0) {
						delete(this.channel[clientId])
					}
				}
				let payloads = {};
				for (const clientId of serverDecrypted.p) {
					if (!this.channel[clientId]) {
						this.channel[clientId] = {
							username: null,
							keys: this.clientEc.genKeyPair(),
							shared: null,
						};
						payloads[clientId] = this.channel[clientId].keys.getPublic('hex')
					}
				}
				if (Object.keys(payloads).length > 0) {
					this.sendMessage(this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared))
				}
			} catch (error) {
				this.logEvent('onMessage-list', error, 'error')
			}
			if (this.callbacks.onClientList) {
				let clients = [];
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						clients.push({
							clientId: clientId,
							username: this.channel[clientId].username
						})
					}
				}
				try {
					this.callbacks.onClientList(clients)
				} catch (error) {
					this.logEvent('onMessage-client-list-callback', error, 'error')
				}
			}
			return
		}
		if (!this.isString(serverDecrypted.p) || !this.isString(serverDecrypted.c)) {
			return
		}
		if (serverDecrypted.a === 'c' && (!this.channel[serverDecrypted.c] || !this.channel[serverDecrypted.c].shared)) {
			try {
				if (!this.channel[serverDecrypted.c]) {
					this.channel[serverDecrypted.c] = {
						username: null,
						keys: this.clientEc.genKeyPair(),
						shared: null,
					};
					this.sendMessage(this.encryptServerMessage({
						a: 'c',
						p: this.channel[serverDecrypted.c].keys.getPublic('hex'),
						c: serverDecrypted.c
					}, this.serverShared))
				}
				// Remember the peer's public key so both sides can compute and
				// compare the same ECDH channel fingerprint (see getPeerFingerprint).
				this.channel[serverDecrypted.c].peerPub = serverDecrypted.p;
				this.channel[serverDecrypted.c].shared = Buffer.from(this.xorHex(this.channel[serverDecrypted.c].keys.derive(this.clientEc.keyFromPublic(serverDecrypted.p, 'hex').getPublic()).toString('hex').padEnd(64, '8').substr(0, 64), this.credentials.password), 'hex');
				this.sendMessage(this.encryptServerMessage({
					a: 'c',
					p: this.encryptClientMessage({
						a: 'u',
						p: this.credentials.username
					}, this.channel[serverDecrypted.c].shared),
					c: serverDecrypted.c
				}, this.serverShared))
			} catch (error) {
				this.logEvent('onMessage-client', error, 'error')
			}
			return
		}
		if (serverDecrypted.a === 'c' && this.channel[serverDecrypted.c] && this.channel[serverDecrypted.c].shared) {
			const clientDecrypted = this.decryptClientMessage(serverDecrypted.p, this.channel[serverDecrypted.c].shared);
			// SECURITY: log only the action type, never the payload
			this.logEvent('onMessage-client-decrypted', clientDecrypted.a);
			if (!this.isObject(clientDecrypted) || !this.isString(clientDecrypted.a)) {
				return
			}
			if (clientDecrypted.a === 'u' && this.isString(clientDecrypted.p) && clientDecrypted.p.match(/\S+/) && !this.channel[serverDecrypted.c].username) {
				this.channel[serverDecrypted.c].username = clientDecrypted.p.replace(/^\s+/, '').replace(/\s+$/, '');
				if (this.callbacks.onClientSecured) {
					try {
						this.callbacks.onClientSecured({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username
						})
					} catch (error) {
						this.logEvent('onMessage-client-secured-callback', error, 'error')
					}
				}
				return
			}			if (!this.channel[serverDecrypted.c].username) {
				return
			}
			if (clientDecrypted.a === 'm' && this.isString(clientDecrypted.t) && (this.isString(clientDecrypted.d) || this.isObject(clientDecrypted.d))) {
				if (this.callbacks.onClientMessage) {
					try {
						// mentions: optional array of clientIds (content-layer field)
						// rt/q/ttl: P1-B reply-quote + burn-timer (content-layer only)
						this.callbacks.onClientMessage({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							type: clientDecrypted.t,
							data: clientDecrypted.d,
							id: this.isString(clientDecrypted.id) ? clientDecrypted.id : null,
							mentions: Array.isArray(clientDecrypted.m) ? clientDecrypted.m.filter(m => this.isString(m)) : [],
							rid: this.isString(clientDecrypted.rt) && /^[A-Za-z0-9]{8,32}$/.test(clientDecrypted.rt) ? clientDecrypted.rt : null,
							quote: (this.isObject(clientDecrypted.q)
								&& this.isString(clientDecrypted.q.x)
								&& clientDecrypted.q.x.length <= 300)
								? { u: this.isString(clientDecrypted.q.u) ? clientDecrypted.q.u.slice(0, 64) : '', x: clientDecrypted.q.x }
								: null,
							ttl: (clientDecrypted.ttl === 30 || clientDecrypted.ttl === 300 || clientDecrypted.ttl === 3600) ? clientDecrypted.ttl : null
						})
					} catch (error) {
						this.logEvent('onMessage-client-message-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 'r' && this.isString(clientDecrypted.id) && this.isString(clientDecrypted.e)) {
				// Emoji reaction on a message (content-layer action; server never sees it)
				if (this.callbacks.onClientReaction) {
					try {
						this.callbacks.onClientReaction({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							targetId: clientDecrypted.id,
							emoji: clientDecrypted.e
						})
					} catch (error) {
						this.logEvent('onMessage-client-reaction-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 't') {
				// Typing signal: carries no content at all, only "someone is typing".
				// 内容为零的输入中信号，不携带任何文本。
				if (this.callbacks.onClientTyping) {
					try {
						this.callbacks.onClientTyping({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username
						})
					} catch (error) {
						this.logEvent('onMessage-client-typing-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 'edit' && this.isString(clientDecrypted.id) && this.isString(clientDecrypted.t)) {
				// P1-B: edit of an earlier text message (content-layer action).
				// Receivers still verify authorship + time window before applying.
				if (this.callbacks.onClientEdit) {
					try {
						this.callbacks.onClientEdit({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							targetId: clientDecrypted.id,
							text: clientDecrypted.t.slice(0, 10000),
							mentions: Array.isArray(clientDecrypted.m) ? clientDecrypted.m.filter(m => this.isString(m)) : []
						})
					} catch (error) {
						this.logEvent('onMessage-client-edit-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 'del' && this.isString(clientDecrypted.id)) {
				// P1-B: recall (delete) of an earlier message (content-layer action).
				if (this.callbacks.onClientDelete) {
					try {
						this.callbacks.onClientDelete({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							targetId: clientDecrypted.id
						})
					} catch (error) {
						this.logEvent('onMessage-client-delete-callback', error, 'error')
					}
				}
				return
			}

			if (clientDecrypted.a === 'rr') {
				// P1-C: read receipts. The sender lists message ids they have
				// actually seen (window visible + focused). Content-free signal.
				// P1-C: 已读回执。发送方列出确实看过的消息 id（窗口可见且聚焦），
				// 纯信号不携带内容。
				if (Array.isArray(clientDecrypted.ids) && this.callbacks.onClientReadReceipt) {
					const safeIds = clientDecrypted.ids
						.filter((mid) => this.isString(mid) && /^[A-Za-z0-9]{8,32}$/.test(mid))
						.slice(0, 50);
					if (safeIds.length > 0) {
						try {
							this.callbacks.onClientReadReceipt({
								clientId: serverDecrypted.c,
								ids: safeIds
							})
						} catch (error) {
							this.logEvent('onMessage-client-rr-callback', error, 'error')
						}
					}
				}
				return
			}
			if (clientDecrypted.a === 'st' && this.isString(clientDecrypted.s)) {
				// v1.4.0 #12: user-declared presence status (online/away/busy).
				// Opt-in metadata — the sender chose to share one of three bits.
				// Receivers whitelist-validate; receivers re-check in room.js.
				// v1.4.0 #12：用户主动声明的在线状态（online/away/busy）。
				// 自愿元数据——发送方选择共享这一个状态位；接收端再验白名单。
				if (this.callbacks.onClientStatus) {
					try {
						this.callbacks.onClientStatus({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							s: clientDecrypted.s
						})
					} catch (error) {
						this.logEvent('onMessage-client-status-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 'sync') {
				// P2: peer replay sync request. A reconnecting peer asks the
				// room to replay messages sent while it was offline. Carries
				// only a watermark timestamp + a few known ids — no content.
				// P2: 同伴重播请求。重连方请房间补发其离线期间的消息，仅携带
				// 水位时间戳 + 少量已知 id，不携带任何内容。
				const since = (typeof clientDecrypted.since === 'number' && clientDecrypted.since >= 0 && clientDecrypted.since <= Date.now() + 60000) ? Math.floor(clientDecrypted.since) : 0;
				const ids = Array.isArray(clientDecrypted.ids)
					? clientDecrypted.ids.filter((mid) => this.isString(mid) && /^[A-Za-z0-9]{8,32}$/.test(mid)).slice(0, 20)
					: [];
				if (this.callbacks.onClientSync) {
					try {
						this.callbacks.onClientSync({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							since,
							ids
						})
					} catch (error) {
						this.logEvent('onMessage-client-sync-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 'rs' && Array.isArray(clientDecrypted.msgs)) {
				// P2: peer replay batch (unicast response to 'sync'). Entries are
				// strictly sanitized — text/image only, hard size caps, id whitelist.
				// P2: 同伴重播批次（对 'sync' 的单播应答）。逐条严格消毒——仅文本/图片，
				// 硬性大小上限，id 白名单。
				const msgs = [];
				for (const e of clientDecrypted.msgs.slice(0, 50)) {
					if (!this.isObject(e)) continue;
					if (!this.isString(e.id) || !/^[A-Za-z0-9]{8,32}$/.test(e.id)) continue;
					if ((e.t !== 'text' && e.t !== 'image') || !this.isString(e.d) || e.d.length === 0) continue;
					if (e.t === 'text' && e.d.length > 10000) continue;
					if (e.t === 'image' && e.d.length > 300000) continue;
					msgs.push({
						id: e.id,
						t: e.t,
						d: e.d,
						ts: (typeof e.ts === 'number' && e.ts >= 0) ? Math.floor(e.ts) : 0,
						u: this.isString(e.u) ? e.u.slice(0, 64) : '',
						self: e.self === true,
						m: Array.isArray(e.m) ? e.m.filter((x) => this.isString(x) && /^[A-Za-z0-9]{8,32}$/.test(x)).slice(0, 20) : [],
						q: (this.isObject(e.q) && this.isString(e.q.x) && e.q.x.length <= 300)
							? { u: this.isString(e.q.u) ? e.q.u.slice(0, 64) : '', x: e.q.x }
							: null,
						ttl: (e.ttl === 30 || e.ttl === 300 || e.ttl === 3600) ? e.ttl : null
					});
				}
				if (msgs.length > 0 && this.callbacks.onClientReplay) {
					try {
						this.callbacks.onClientReplay({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							msgs
						})
					} catch (error) {
						this.logEvent('onMessage-client-replay-callback', error, 'error')
					}
				}
				return
			}
		}
	}

	// WebSocket error event handler
	// WebSocket 错误事件处理
	async onError(event) {
		this.logEvent('onError', event, 'error');
		this.disconnect();
		if (this.credentials) {
			this.startReconnect()
		}
		if (this.callbacks.onServerClosed) {
			try {
				this.callbacks.onServerClosed()
			} catch (error) {
				this.logEvent('onError-server-closed-callback', error, 'error')
			}
		}
	}

	// WebSocket close event handler
	// WebSocket 关闭事件处理
	async onClose(event) {
		this.logEvent('onClose', event);
		this.disconnect();
		if (this.credentials) {
			this.startReconnect()
		}
		if (this.callbacks.onServerClosed) {
			try {
				this.callbacks.onServerClosed()
			} catch (error) {
				this.logEvent('onClose-server-closed-callback', error, 'error')
			}
		}
	}

	// Log events for debugging
	// 记录事件日志用于调试
	logEvent(source, message, level) {
		if (this.config.debug) {
			const date = new Date(),
				dateString = date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2) + ' ' + ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2) + ':' + ('0' + date.getSeconds()).slice(-2);
			console.log('[' + dateString + ']', (level ? level.toUpperCase() : 'INFO'), source + (message ? ':' : ''), (message ? message : ''))
		}
	}

	// Check if connection is open
	// 检查连接是否已打开
	isOpen() {
		return (this.connection && this.connection.readyState && this.connection.readyState === WebSocket.OPEN ? true : false)
	}

	// Check if connection is closed
	// 检查连接是否已关闭
	isClosed() {
		return (!this.connection || !this.connection.readyState || this.connection.readyState === WebSocket.CLOSED ? true : false)
	}

	// Start reconnect timer
	// 启动重连定时器
	startReconnect() {
		this.stopReconnect();
		this.logEvent('startReconnect');
		this.reconnect = setTimeout(() => {
			this.reconnect = null;
			this.connect()
		}, this.config.reconnectDelay)
	}

	// Stop reconnect timer
	// 停止重连定时器
	stopReconnect() {
		if (this.reconnect) {
			this.logEvent('stopReconnect');
			clearTimeout(this.reconnect);
			this.reconnect = null
		}
	}

	// Start ping timer
	// 启动心跳定时器
	startPing() {
		this.stopPing();
		this.logEvent('startPing');
		this.ping = setInterval(() => {
			this.sendMessage('ping')
		}, this.config.pingInterval)
	}

	// Stop ping timer
	// 停止心跳定时器
	stopPing() {
		if (this.ping) {
			this.logEvent('stopPing');
			clearInterval(this.ping);
			this.ping = null
		}
	}

	// Disconnect from server
	// 从服务器断开连接
	disconnect() {
		this.stopReconnect();
		this.stopPing();
		if (!this.isClosed()) {
			try {
				this.logEvent('disconnect');
				this.connection.close()
			} catch (error) {
				this.logEvent('disconnect', error, 'error')
			}
		}
	}

	// Send a message to the server
	// 向服务器发送消息
	sendMessage(message) {
		try {
			if (this.isOpen()) {
				this.connection.send(message);
				return (true)
			}
		} catch (error) {
			this.logEvent('sendMessage', error, 'error')
		}
		return (false)
	}

	// Send a message to all channels
	// 向所有频道发送消息
	// Generate a random message id (16 hex chars). Random, carries no
	// metadata — used only to target reactions.
	// 生成随机消息 ID（16 位十六进制）。纯随机、不携带任何元数据，仅用于表情回应定位。
	genMessageId() {
		const bytes = crypto.getRandomValues(new Uint8Array(8));
		return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
	}

	sendChannelMessage(type, data, extras) {
		if (this.serverShared) {
			try {
				// extras: optional additional content-layer fields (e.g. mentions).
				// SECURITY: extras travel inside the E2EE content layer only;
				// the server relays them opaquely and can never read them.
				const messageId = this.genMessageId();
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage(Object.assign({
							a: 'm',
							t: type,
							d: data,
							id: messageId
						}, extras || {}), this.channel[clientId].shared);
						if (payloads[clientId].length === 0) {
							return (false)
						}
					}
				}
				if (Object.keys(payloads).length > 0) {
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (messageId)
			} catch (error) {
				this.logEvent('sendChannelMessage', error, 'error')
			}
		}
		return (false)
	}

	// Broadcast an emoji reaction on a message to all channel members.
	// The reaction travels inside the existing E2EE content layer as its own
	// action type ('r') — the server relays it opaquely, zero protocol change.
	// 向全频道广播消息表情回应。回应作为独立 action（'r'）走既有 E2EE 内容层，服务器盲转发。
	sendReaction(targetMessageId, emoji) {
		if (this.serverShared) {
			try {
				// SECURITY: validate locally before sending; receivers re-validate.
				const safeId = String(targetMessageId || '');
				const safeEmoji = String(emoji || '');
				if (!/^[A-Za-z0-9]{8,32}$/.test(safeId) || !safeEmoji || safeEmoji.length > 16) {
					return (false)
				}
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage({
							a: 'r',
							id: safeId,
							e: safeEmoji
						}, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendReaction', error, 'error')
			}
		}
		return (false)
	}

	// Broadcast a typing signal to all channel members (throttled to one
	// signal per TYPING_SEND_INTERVAL). The signal is an empty content-layer
	// action ('t') inside the existing E2EE 'w' envelope — it carries no text
	// and the server relays it opaquely, exactly like any other payload.
	// 向全频道广播输入中信号（节流）。空内容 action（'t'）走既有 E2EE 信封，服务器盲转发。
	sendTyping() {
		if (this.serverShared) {
			try {
				const now = Date.now();
				if (this.lastTypingSent && (now - this.lastTypingSent) < 3000) {
					return (true) // throttled / 节流窗口内直接吞掉
				}
				this.lastTypingSent = now;
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage({
							a: 't'
						}, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					// R2: np:1 — typing must never wake offline subscribers.
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
						np: 1
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendTyping', error, 'error')
			}
		}
		return (false)
	}

	// P1-B: broadcast an edit of an earlier text message. Content-layer action
	// ('edit') inside the existing E2EE 'w' envelope — server relays opaquely.
	// Receivers re-verify authorship + the edit time window before applying.
	// P1-B：广播对早期文本消息的编辑。内容层 action（'edit'）走既有 E2EE 信封。
	sendEdit(targetMessageId, newText, mentions) {
		if (this.serverShared) {
			try {
				const safeId = String(targetMessageId || '');
				const safeText = String(newText || '').slice(0, 10000);
				if (!/^[A-Za-z0-9]{8,32}$/.test(safeId) || !safeText.trim()) {
					return (false)
				}
				const safeMentions = Array.isArray(mentions)
					? mentions.filter(m => this.isString(m)).slice(0, 32)
					: [];
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						const body = {
							a: 'edit',
							id: safeId,
							t: safeText
						};
						if (safeMentions.length) body.m = safeMentions;
						payloads[clientId] = this.encryptClientMessage(body, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendEdit', error, 'error')
			}
		}
		return (false)
	}

	// P1-B: broadcast a recall (delete) of an earlier message. Content-layer
	// action ('del') inside the existing E2EE 'w' envelope — server relays
	// opaquely. Receivers re-verify authorship before applying.
	// P1-B：广播撤回早期消息。内容层 action（'del'）走既有 E2EE 信封。
	sendDelete(targetMessageId) {
		if (this.serverShared) {
			try {
				const safeId = String(targetMessageId || '');
				if (!/^[A-Za-z0-9]{8,32}$/.test(safeId)) {
					return (false)
				}
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage({
							a: 'del',
							id: safeId
						}, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendDelete', error, 'error')
			}
		}
		return (false)
	}

	// Broadcast read receipts (P1-C): list of message ids the local user has
	// actually seen. Pure signal inside the E2EE content layer, server-blind.
	// 广播已读回执（P1-C）：确实看过的消息 id 列表，E2EE 内容层纯信号。
	sendReadReceipts(messageIds) {
		if (this.serverShared) {
			try {
				if (!Array.isArray(messageIds)) return (false);
				const safeIds = messageIds
					.filter((mid) => this.isString(mid) && /^[A-Za-z0-9]{8,32}$/.test(mid))
					.slice(0, 50);
				if (safeIds.length === 0) return (false);
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage({
							a: 'rr',
							ids: safeIds
						}, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					// R2: np:1 — read receipts must never wake offline subscribers.
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
						np: 1
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendReadReceipts', error, 'error')
			}
		}
		return (false)
	}

	// v1.4.0 #12: broadcast the local user's self-declared presence status
	// (online/away/busy) to all channel members. Content-layer action ('st')
	// inside the E2EE 'w' envelope, np:1 — never wakes offline subscribers,
	// exactly like typing/read-receipts. Callers pass an already-whitelisted
	// value; receivers re-validate (defense in depth).
	// v1.4.0 #12：向全频道广播本端用户自声明的在线状态。内容层 action（'st'）
	// 走既有 E2EE 信封，np:1——绝不唤醒离线订阅者，与输入中/已读回执同规。
	sendPresenceStatus(status) {
		if (this.serverShared) {
			try {
				if (status !== 'online' && status !== 'away' && status !== 'busy') {
					return (false)
				}
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage({
							a: 'st',
							s: status
						}, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					// R2 / 不变量 8: np:1 — presence must never wake offline subscribers.
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
						np: 1
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendPresenceStatus', error, 'error')
			}
		}
		return (false)
	}

	// Broadcast a replay sync request (P2). After a reconnect, the client
	// asks all peers to replay messages sent while it was offline. Payload
	// carries a watermark timestamp + a few known message ids only.
	// 广播重播请求（P2）。重连后请所有同伴补发本端离线期间的消息，载荷仅含
	// 水位时间戳 + 少量已知消息 id。
	sendSyncRequest(since, knownIds) {
		if (this.serverShared) {
			try {
				const s = (typeof since === 'number' && since >= 0 && since <= Date.now() + 60000) ? Math.floor(since) : 0;
				const ids = Array.isArray(knownIds)
					? knownIds.filter((mid) => this.isString(mid) && /^[A-Za-z0-9]{8,32}$/.test(mid)).slice(0, 20)
					: [];
				let payloads = {};
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						payloads[clientId] = this.encryptClientMessage({
							a: 'sync',
							since: s,
							ids
						}, this.channel[clientId].shared);
					}
				}
				if (Object.keys(payloads).length > 0) {
					// R2: np:1 — sync requests must never wake offline subscribers.
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
						np: 1
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendSyncRequest', error, 'error')
			}
		}
		return (false)
	}

	// Unicast a replay batch (P2) to one reconnecting peer via the 'c' relay
	// path. Entries are sanitized before encryption; receivers re-validate.
	// 单播重播批次（P2）给指定重连方，走 'c' 中继路径。加密前先消毒，接收端再验。
	sendSyncReplay(targetId, entries) {
		if (this.serverShared) {
			try {
				const target = this.channel[targetId];
				if (!target || !target.shared || !target.username) return (false);
				if (!Array.isArray(entries) || entries.length === 0) return (false);
				const msgs = [];
				for (const e of entries.slice(0, 50)) {
					if (!this.isObject(e)) continue;
					if (!this.isString(e.id) || !/^[A-Za-z0-9]{8,32}$/.test(e.id)) continue;
					if ((e.t !== 'text' && e.t !== 'image') || !this.isString(e.d) || e.d.length === 0) continue;
					if (e.t === 'text' && e.d.length > 10000) continue;
					if (e.t === 'image' && e.d.length > 300000) continue;
					msgs.push({
						id: e.id,
						t: e.t,
						d: e.d,
						ts: (typeof e.ts === 'number' && e.ts >= 0) ? Math.floor(e.ts) : 0,
						u: this.isString(e.u) ? e.u.slice(0, 64) : '',
						self: e.self === true,
						m: Array.isArray(e.m) ? e.m.filter((x) => this.isString(x) && /^[A-Za-z0-9]{8,32}$/.test(x)).slice(0, 20) : [],
						q: (this.isObject(e.q) && this.isString(e.q.x) && e.q.x.length <= 300)
							? { u: this.isString(e.q.u) ? e.q.u.slice(0, 64) : '', x: e.q.x.slice(0, 300) }
							: null,
						ttl: (e.ttl === 30 || e.ttl === 300 || e.ttl === 3600) ? e.ttl : null
					});
				}
				if (msgs.length === 0) return (false);
				const clientMessagePayload = this.encryptClientMessage({
					a: 'rs',
					msgs
				}, target.shared);
				const serverRelayPayload = this.encryptServerMessage({
					a: 'c',
					p: clientMessagePayload,
					c: targetId,
					// R2: replay batches are history backfill, not new messages.
					np: 1
				}, this.serverShared);
				if (!this.isOpen() || serverRelayPayload.length === 0 || serverRelayPayload.length > (8 * 1024 * 1024)) {
					return (false)
				}
				this.sendMessage(serverRelayPayload);
				return (true)
			} catch (error) {
				this.logEvent('sendSyncReplay', error, 'error')
			}
		}
		return (false)
	}

	// Report a Web Push subscription endpoint to the server (P1-C). Travels
	// over the E2EE transport layer as its own action ('ps') — the server
	// learns only the opaque endpoint URL, nothing about rooms or messages.
	// 向服务器上报 Web Push 订阅端点（P1-C）。走 E2EE 传输层独立 action（'ps'）。
	sendPushSubscribe(endpoint) {
		if (this.serverShared) {
			try {
				if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 500) {
					return (false)
				}
				if (!this.isOpen()) return (false);
				this.sendMessage(this.encryptServerMessage({
					a: 'ps',
					p: endpoint
				}, this.serverShared));
				return (true)
			} catch (error) {
				this.logEvent('sendPushSubscribe', error, 'error')
			}
		}
		return (false)
	}

	// Withdraw a Web Push subscription endpoint (P1-C, action 'pu').
	// 撤回 Web Push 订阅端点（P1-C，action 'pu'）。
	sendPushUnsubscribe(endpoint) {
		if (this.serverShared) {
			try {
				if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 500) {
					return (false)
				}
				if (!this.isOpen()) return (false);
				this.sendMessage(this.encryptServerMessage({
					a: 'pu',
					p: endpoint
				}, this.serverShared));
				return (true)
			} catch (error) {
				this.logEvent('sendPushUnsubscribe', error, 'error')
			}
		}
		return (false)
	}

	// Encrypt a message for the server (AES-256-GCM, authenticated)
	// 使用 AES-256-GCM（认证加密）加密发送给服务器的消息
	// Wire format: base64(12B iv) | base64(ciphertext || 16B tag)
	encryptServerMessage(message, key) {
		let encrypted = '';
		try {
			message = Buffer.from(JSON.stringify(message), 'utf8');
			const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
			const cipher = new GCM(new AES(key));
			const sealed = cipher.seal(iv, message);
			encrypted = iv.toString('base64') + '|' + Buffer.from(sealed).toString('base64')
		} catch (error) {
			this.logEvent('encryptServerMessage', error, 'error')
		}
		return (encrypted)
	}

	// Decrypt a message from the server (AES-256-GCM, authenticated)
	// 解密来自服务器的 AES-256-GCM 消息（认证失败即篡改）
	decryptServerMessage(message, key) {
		let decrypted = {};
		try {
			const parts = message.split('|');
			const decipher = new GCM(new AES(key));
			const plain = decipher.open(Buffer.from(parts[0], 'base64'), Buffer.from(parts[1], 'base64'));
			if (!plain) {
				throw new Error('GCM authentication failed')
			}
			decrypted = JSON.parse(Buffer.from(plain).toString('utf8'))
		} catch (error) {
			this.logEvent('decryptServerMessage', error, 'error')
		}
		return (decrypted)
	}

	// Encrypt a message for a client (ChaCha20-Poly1305, authenticated)
	// 使用 ChaCha20-Poly1305（认证加密）加密客户端间消息
	// Wire format: base64(12B nonce) | base64(ciphertext || 16B tag)
	encryptClientMessage(message, key) {
		let encrypted = '';
		try {
			message = Buffer.from(JSON.stringify(message), 'utf8');
			const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
			const aead = new ChaCha20Poly1305(key);
			const sealed = aead.seal(iv, message);
			encrypted = iv.toString('base64') + '|' + Buffer.from(sealed).toString('base64')
		} catch (error) {
			this.logEvent('encryptClientMessage', error, 'error')
		}
		return (encrypted)
	}

	// Decrypt a message from a client (ChaCha20-Poly1305, authenticated)
	// 解密客户端间 ChaCha20-Poly1305 消息（认证失败即篡改）
	decryptClientMessage(message, key) {
		let decrypted = {};
		try {
			const parts = message.split('|');
			const decipher = new ChaCha20Poly1305(key);
			const plain = decipher.open(Buffer.from(parts[0], 'base64'), Buffer.from(parts[1], 'base64'));
			if (!plain) {
				throw new Error('ChaCha20-Poly1305 authentication failed')
			}
			decrypted = JSON.parse(Buffer.from(plain).toString('utf8'))
		} catch (error) {
			this.logEvent('decryptClientMessage', error, 'error')
		}
		return (decrypted)
	}

	// Human-verifiable fingerprint of the E2EE channel with a peer.
	// Both sides hash the same sorted pair of Curve25519 public keys, so the
	// fingerprints match if (and only if) the key exchange was not tampered with.
	// 为与某对端的 E2EE 通道生成可供人工比对的指纹：
	// 双方对排序后的同一对 Curve25519 公钥做哈希，密钥交换未被篡改时指纹必然一致。
	getPeerFingerprint(clientId) {
		const peer = this.channel[clientId];
		if (!peer || !peer.keys || !peer.peerPub || !peer.shared) {
			return null
		}
		try {
			const mine = peer.keys.getPublic('hex');
			const pair = [mine, peer.peerPub].sort();
			return sha256(pair.join(':')).slice(0, 16).replace(/(..)/g, '$1 ').trim()
		} catch (error) {
			this.logEvent('getPeerFingerprint', error, 'error');
			return null
		}
	}

	// XOR two hex strings
	// 对两个十六进制字符串进行异或
	xorHex(a, b) {
		// R4 fix (review 4g): validate hex strictly. Invalid input previously
		// produced 'NaN' garbage or silent misalignment; now it fails loudly.
		// 修复评审 4g：严格校验十六进制，非法输入直接报错而不是产出垃圾密钥。
		if (!this.isString(a) || !this.isString(b) || a.length === 0 || a.length !== b.length) {
			throw new Error('xorHex: inputs must be non-empty hex strings of equal length')
		}
		if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) {
			throw new Error('xorHex: non-hex character in input')
		}
		let result = '';
		for (let i = 0; i < a.length; ++i) {
			result += (parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16)).toString(16)
		}
		return (result)
	}

	// Check if value is a string
	// 检查值是否为字符串
	isString(value) {
		return (value && Object.prototype.toString.call(value) === '[object String]' ? true : false)
	}

	// Check if value is an array
	// 检查值是否为数组
	isArray(value) {
		return (value && Object.prototype.toString.call(value) === '[object Array]' ? true : false)
	}

	// Check if value is an object
	// 检查值是否为对象
	isObject(value) {
		return (value && Object.prototype.toString.call(value) === '[object Object]' ? true : false)
	}

	// Handle server public key (Trust-On-First-Use)
	// 处理服务器公钥（TOFU：首次信任，此后锁定）
	// SECURITY: the server key is pinned on first connection. Any later change
	// — or a mismatch with a pre-configured key — aborts the connection instead
	// of silently re-trusting the new key (which enabled trivial MITM).
	// The pin is namespaced per room (channel hash) because each room maps to
	// its own Durable Object with its own RSA keypair.
	async handleServerKey(data) {
		const serverKey = data && data.key;
		if (!this.isString(serverKey) || !serverKey) {
			return false
		}
		let stored = null;
		try {
			stored = localStorage.getItem(this.pinKey())
		} catch (error) {
			this.logEvent('handleServerKey', error, 'error')
		}
		const pinned = this.config.rsaPublicFixed ? this.config.rsaPublic : stored;
		if (pinned) {
			if (pinned !== serverKey) {
				// R1 fix: a legitimate rotation carries a migration signature —
				// the PREVIOUS (pinned) private key signing the NEW public key.
				// Verifying it with our pin proves the rotation is authentic
				// (a MITM cannot produce it), so we rotate the pin seamlessly.
				// 修复评审 R1：合法轮换携带迁移签名（旧私钥签新公钥），验证通过即无缝换 pin。
				if (this.isString(data.mig) && data.mig && await this.verifyKeyMigration(pinned, serverKey, data.mig)) {
					try {
						localStorage.setItem(this.pinKey(), serverKey)
					} catch (error) {
						this.logEvent('handleServerKey', error, 'error')
					}
					this.config.rsaPublic = serverKey;
					this.logEvent('handleServerKey', 'server key rotated — migration signature verified, pin updated');
					return true
				}
				// No valid migration proof. Could be MITM — or genuine server state
				// loss (e.g. DO namespace reset after a wrangler rename, manual
				// rotation). RULES 第一准则: the trust decision belongs to the user,
				// never to silent auto-retrust. Reconnecting also stops on decline
				// so the prompt cannot be spammed every 3 seconds.
				// 无有效迁移证明：可能是中间人，也可能是服务器状态丢失。信任决策交给用户，
				// 拒绝则停止重连，避免死循环弹窗。
				this.logEvent('handleServerKey', 'server key mismatch — no valid migration signature', 'error');
				const accepted = await this.promptServerKeyReset(serverKey);
				if (accepted) {
					try {
						localStorage.setItem(this.pinKey(), serverKey)
					} catch (error) {
						this.logEvent('handleServerKey', error, 'error')
					}
					this.config.rsaPublic = serverKey;
					this.logEvent('handleServerKey', 'user accepted new server key, pin reset');
					return true
				}
				this.stopReconnect();
				this.disconnect();
				if (this.callbacks.onServerClosed) {
					try {
						this.callbacks.onServerClosed()
					} catch (error) {
						this.logEvent('handleServerKey-callback', error, 'error')
					}
				}
				return false
			}
			this.config.rsaPublic = serverKey;
			return true
		}
		try {
			localStorage.setItem(this.pinKey(), serverKey);
		} catch (error) {
			this.logEvent('handleServerKey', error, 'error')
		}
		this.config.rsaPublic = serverKey;
		return true
	}

	// Verify a key-rotation migration signature: the pinned (previous) public
	// key must verify a RSASSA-PKCS1-v1_5/SHA-256 signature over the raw SPKI
	// bytes of the new public key.
	// 验证密钥轮换迁移签名：用 pin 住的旧公钥验证对「新公钥原始 SPKI 字节」的签名。
	async verifyKeyMigration(pinnedB64, newKeyB64, migB64) {
		try {
			const oldVerifyKey = await crypto.subtle.importKey(
				'spki',
				Buffer.from(pinnedB64, 'base64'),
				{ name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
				false,
				['verify']
			);
			const newKeyBytes = Buffer.from(newKeyB64, 'base64');
			const sigBytes = Buffer.from(migB64, 'base64');
			return await crypto.subtle.verify(
				{ name: 'RSASSA-PKCS1-v1_5' },
				oldVerifyKey,
				sigBytes,
				newKeyBytes
			) === true
		} catch (error) {
			this.logEvent('verifyKeyMigration', error, 'error');
			return false
		}
	}

	// Ask the user explicitly before re-trusting a changed server key.
	// Overridable via callbacks.onServerKeyMismatch for custom UI.
	// 重置服务器密钥前显式询问用户；可通过 onServerKeyMismatch 回调自定义 UI。
	async promptServerKeyReset(newKeyFingerprintSource) {
		if (this.callbacks.onServerKeyMismatch) {
			try {
				return this.callbacks.onServerKeyMismatch(newKeyFingerprintSource) === true
			} catch (error) {
				this.logEvent('promptServerKeyReset', error, 'error');
				return false
			}
		}
		if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
			return false
		}
		return window.confirm(
			'⚠️ 服务器安全密钥已变更，且未携带有效的轮换证明。\n\n' +
			'可能原因：① 服务器被重新部署/状态重置（正常）；② 有人正在中间劫持连接（危险）。\n\n' +
			'如果你是服务器管理员，或确认本次变更合法，点击「确定」信任新密钥并继续；否则点击「取消」断开连接。\n\n' +
			'The server security key changed without a valid rotation proof. This may be a redeploy, or a man-in-the-middle attack. Accept the new key only if you trust this change.'
		)
	}

	// Per-room TOFU pin storage key (each room DO has its own RSA keypair)
	// 每个房间独立的服务器密钥 pin 存储键
	pinKey() {
		return (this.credentials && this.credentials.channel)
			? 'nodecrypt_server_key:' + this.credentials.channel
			: 'nodecrypt_server_key'
	}
};

if (typeof window !== 'undefined') {
	window.NodeCrypt = NodeCrypt
}
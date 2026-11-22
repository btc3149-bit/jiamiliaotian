// Black-box integration tests for the Node relay server (X-2 scaffold,
// PR-3). Spawns server/server.js, speaks the real transport protocol
// (P-384 ECDH handshake + AES-256-GCM envelope) with Node's ws + crypto,
// and asserts join/member-list/disconnect behaviour end to end.
// Node 服务端黑盒集成测试：真实握手 + 加密信封，断言入房/成员列表/断线。
// Requires: cd server && npm ci --ignore-scripts (run once).
// Run: node test-server-integration.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(root, 'server');
if (!fs.existsSync(path.join(serverDir, 'node_modules', 'ws'))) {
	console.error('test-server-integration: server/node_modules missing — run: cd server && npm ci --ignore-scripts');
	process.exit(1);
}
const require = createRequire(path.join(serverDir, 'package.json'));
const WebSocket = require('ws');

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function encryptMessage(obj, key) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')), cipher.final()]);
	return iv.toString('base64') + '|' + Buffer.concat([ct, cipher.getAuthTag()]).toString('base64');
}
function decryptMessage(wire, key) {
	const parts = String(wire).split('|');
	const sealed = Buffer.from(parts[1], 'base64');
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64'));
	decipher.setAuthTag(sealed.subarray(sealed.length - 16));
	return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]).toString('utf8'));
}

class TestClient {
	constructor(url = 'ws://127.0.0.1:8088', localAddress) { this.decrypted = []; this.raw = []; this.url = url; this.localAddress = localAddress; }
	async connect() {
		// The banner prints before the listen socket is fully bound; retry.
		let lastErr = null;
		for (let i = 0; i < 50; i++) {
			try {
				this.ws = new WebSocket(this.url, this.localAddress ? { localAddress: this.localAddress } : undefined);
				this.ws.on('message', d => this.onMessage(d.toString()));
				await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
				return this;
			} catch (e) { lastErr = e; await sleep(100); }
		}
		throw lastErr || new Error('connect failed');
	}
	onMessage(msg) {
		this.raw.push(msg);
		if (msg.startsWith('{')) {
			try { const o = JSON.parse(msg); if (o.type === 'server-key') this.serverKey = o.key; } catch (_e) { /* ignore */ }
			return;
		}
		if (this.pendingHandshake && msg.includes('|')) {
			const serverPub = msg.split('|')[0];
			this.shared = this.ecdh.computeSecret(serverPub, 'hex', null).slice(8, 40);
			this.pendingHandshake = false;
			return;
		}
		if (this.shared) {
			try { this.decrypted.push(decryptMessage(msg, this.shared)); } catch (_e) { /* ignore */ }
		}
	}
	async handshake() {
		this.ecdh = crypto.createECDH('secp384r1');
		this.ecdh.generateKeys();
		this.pendingHandshake = true;
		this.ws.send(this.ecdh.getPublicKey('hex', 'uncompressed'));
		for (let i = 0; i < 50 && this.pendingHandshake; i++) await sleep(100);
		if (this.pendingHandshake) throw new Error('handshake timed out');
	}
	send(obj) { this.ws.send(encryptMessage(obj, this.shared)); }
	async waitFor(pred, timeout = 3000) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeout) {
			const hit = this.decrypted.find(pred);
			if (hit) return hit;
			await sleep(50);
		}
		return null;
	}
	close() { try { this.ws.close(); } catch (_e) { /* ignore */ } }
}

// ---- spawn server ----
const srv = spawn('node', ['server.js'], { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });
async function waitServer() {
	for (let i = 0; i < 100; i++) {
		if (srvLog.includes('server started')) return true;
		await sleep(100);
	}
	return false;
}

try {
	console.log('=== test-server-integration: boot ===');
	check('server starts and logs banner', await waitServer());

	const channel = crypto.createHash('sha256').update('integration-room').digest('hex');
	const a = await new TestClient().connect();
	await a.handshake();
	check('client A handshake derives shared key', !!a.shared && a.shared.length === 32);
	check('client A received server-key', typeof a.serverKey === 'string' && a.serverKey.length > 100);

	console.log('=== test-server-integration: S-5 channel format guard ===');
	a.send({ a: 'j', p: 'not-a-hex-channel!' });
	await sleep(600);
	check('non-hex channel join yields no member list', !a.decrypted.some(m => m.a === 'l'));
	a.send({ a: 'j', p: channel });
	const la = await a.waitFor(m => m.a === 'l');
	check('valid 64-hex join yields member list', !!la);

	console.log('=== test-server-integration: member list lifecycle ===');
	const b = await new TestClient().connect();
	await b.handshake();
	b.send({ a: 'j', p: channel });
	const lb = await b.waitFor(m => m.a === 'l' && Array.isArray(m.p) && m.p.length === 1);
	check('client B sees exactly one other member', !!lb);
	const la2 = await a.waitFor(m => m.a === 'l' && Array.isArray(m.p) && m.p.length === 1, 3000);
	check('client A is notified of B joining', !!la2);
	b.close();
	const la3 = await a.waitFor(m => m.a === 'l' && Array.isArray(m.p) && m.p.length === 0, 3000);
	check('after B disconnects, A receives emptied member list', !!la3);

	console.log('=== test-server-integration: disconnect churn robustness ===');
	for (let i = 0; i < 7; i++) {
		const c = await new TestClient().connect(); // 7 churn + A + B = 9 handshakes, inside the S-2 per-IP window (10/min)
		await c.handshake();
		c.send({ a: 'j', p: channel });
		await sleep(30);
		c.close();
	}
	await sleep(500);
	a.send({ a: 'j', p: channel }); // A already in a channel: server ignores; use ping instead below
	a.ws.send('ping');
	await sleep(300);
	check('server still answers ping after churn', a.raw.includes('pong'));
	check('server process still alive', srv.exitCode === null);
	a.close();
} catch (e) {
	check('integration run completed without exception (' + e.message + ')', false);
} finally {
	srv.kill('SIGKILL');
	await sleep(200);
}


// ================= PR-4 (S-1/S-2) black-box sections =================
// Each section uses a fresh server process (fresh per-IP windows) on its
// own port via the S-1 env override.
async function spawnServer(env, _port) {
	const proc = spawn('node', ['server.js'], { cwd: serverDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
	let log = '';
	proc.stdout.on('data', d => { log += d; });
	proc.stderr.on('data', d => { log += d; });
	for (let i = 0; i < 100 && !log.includes('server started'); i++) await sleep(100);
	return proc;
}
async function rawConnect(url) {
	let lastErr = null;
	for (let i = 0; i < 50; i++) {
		try {
			return await new Promise((resolve, reject) => {
				const ws = new WebSocket(url);
				ws.on('open', () => resolve(ws));
				ws.on('error', reject);
			});
		} catch (e) { lastErr = e; await sleep(100); }
	}
	throw lastErr || new Error('rawConnect failed');
}
async function waitClose(ws, timeout = 4000) {
	return await new Promise(resolve => {
		const to = setTimeout(() => resolve(-1), timeout);
		ws.on('close', code => { clearTimeout(to); resolve(code); });
	});
}

{ // maxPayload + rate limit + handshake guards
	const proc = await spawnServer({ PORT: '8091' }, 8091);
	try {
		console.log('=== test-server-integration: S-1 maxPayload ===');
		const big = await rawConnect('ws://127.0.0.1:8091');
		big.send('x'.repeat(8 * 1024 * 1024 + 1));
		const bigCode = await waitClose(big);
		check('frame over 8MB terminates connection (1009)', bigCode === 1009);
		const okClient = await rawConnect('ws://127.0.0.1:8091');
		let pong = false;
		okClient.on('message', d => { if (d.toString() === 'pong') pong = true; });
		await sleep(300);
		okClient.send('ping');
		await sleep(300);
		check('other connection unaffected by maxPayload kill', pong === true);
		okClient.close();

		console.log('=== test-server-integration: S-1 token bucket ===');
		const flood = await rawConnect('ws://127.0.0.1:8091');
		await sleep(200);
		for (let i = 0; i < 300; i++) { try { flood.send('x'); } catch (_e) { break; } }
		const floodCode = await waitClose(flood);
		check('flooding connection is closed by the guards (bucket/shape)', floodCode !== -1);
		const legit = await new TestClient('ws://127.0.0.1:8091').connect();
		await legit.handshake();
		let legitPongs = 0;
		legit.ws.on('message', d => { if (d.toString() === 'pong') legitPongs++; });
		for (let i = 0; i < 250; i++) { legit.ws.send('ping'); await sleep(20); } // 50/s for 5s
		check('legit 50 frames/s for 5s stays connected', legit.ws.readyState === legit.ws.OPEN && legitPongs > 200);
		legit.ws.send(legit.ecdh.getPublicKey('hex', 'uncompressed'));
		await sleep(300);
		check('post-handshake handshake frame dropped, connection stays up', legit.ws.readyState === legit.ws.OPEN);
		legit.close();

		console.log('=== test-server-integration: S-2 handshake shape guard ===');
		const bad = await rawConnect('ws://127.0.0.1:8091');
		await sleep(200);
		bad.send('zz-not-a-key');
		const badCode = await waitClose(bad);
		check('malformed handshake frame closes connection before crypto', badCode !== -1);
	} finally { proc.kill('SIGKILL'); await sleep(200); }
}

{ // per-IP handshake window: 10 pass, 11th upgrade refused 429
	const proc = await spawnServer({ PORT: '8092' }, 8092);
	try {
		console.log('=== test-server-integration: S-2 per-IP handshake window ===');
		let okCount = 0;
		for (let i = 0; i < 10; i++) {
			const c = await new TestClient('ws://127.0.0.1:8092').connect();
			await c.handshake();
			if (c.shared) okCount++;
			c.close();
			await sleep(30);
		}
		check('first 10 handshakes from one IP succeed', okCount === 10);
		let refused = false;
		try {
			const c11 = await new TestClient('ws://127.0.0.1:8092').connect();
			c11.close();
		} catch (_e) { refused = true; }
		check('11th connection in window is refused (429)', refused === true);
	} finally { proc.kill('SIGKILL'); await sleep(200); }
}

{ // fanout cap: 65 members via 9 loopback IPs (per-IP windows respected)
	const proc = await spawnServer({ HOST: '0.0.0.0', PORT: '8093' }, 8093);
	try {
		console.log('=== test-server-integration: S-1 fanout cap ===');
		const channel = crypto.createHash('sha256').update('fanout-room').digest('hex');
		const members = [];
		for (let i = 0; i < 65; i++) {
			const ip = '127.0.0.' + (2 + (i % 9));
			const c = await new TestClient(`ws://${ip}:8093`, ip).connect();
			await c.handshake();
			c.send({ a: 'j', p: channel });
			members.push(c);
		}
		const sender = members[0];
		// sender learns member ids from 'l' lists; wait until it sees 64 others
		let others = null;
		for (let i = 0; i < 100; i++) {
			const lists = sender.decrypted.filter(m => m.a === 'l');
			const last = lists[lists.length - 1];
			if (last && Array.isArray(last.p) && last.p.length >= 64) { others = last.p; break; }
			await sleep(100);
		}
		check('sender sees 64 other members', !!others);
		if (others) {
			const targets = {};
			for (const id of others) targets[id] = 'AAAA';
			// include the sender itself: 65 target keys in one frame
			sender.send({ a: 'w', p: targets });
			await sleep(1500);
			let deliveries = 0;
			for (const m of members) deliveries += m.decrypted.filter(x => x.a === 'c').length;
			check('one frame fans out to at most 64 recipients', deliveries === 64);
		}
		for (const m of members) m.close();
	} finally { proc.kill('SIGKILL'); await sleep(200); }
}

{ // Item 32: /healthz — 200 + bare "ok", no business metadata whatsoever
	const proc = await spawnServer({ PORT: '8094' }, 8094);
	try {
		console.log('=== test-server-integration: /healthz (item 32) ===');
		const res = await fetch('http://127.0.0.1:8094/healthz');
		const body = await res.text();
		check('GET /healthz returns 200', res.status === 200);
		check('GET /healthz body is exactly "ok"', body === 'ok');
		check('/healthz leaks no metadata (no key/channel/client/version fields)',
			!/rsa|key|channel|client|version|member|room/i.test(body));
		const miss = await fetch('http://127.0.0.1:8094/nope');
		check('unknown HTTP path returns bare 404', miss.status === 404);
	} finally { proc.kill('SIGKILL'); await sleep(200); }
}

console.log(`\ntest-server-integration: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

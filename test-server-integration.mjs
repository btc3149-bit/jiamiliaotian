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
	constructor() { this.decrypted = []; this.raw = []; }
	async connect() {
		// The banner prints before the listen socket is fully bound; retry.
		let lastErr = null;
		for (let i = 0; i < 50; i++) {
			try {
				this.ws = new WebSocket('ws://127.0.0.1:8088');
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
	for (let i = 0; i < 10; i++) {
		const c = await new TestClient().connect();
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

console.log(`\ntest-server-integration: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

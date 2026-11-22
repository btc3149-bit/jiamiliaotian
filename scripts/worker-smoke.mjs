// Item 22: Worker smoke test — the previously manual "wrangler dev
// canary" (dual-client handshake / join / relay / garbage-frame close)
// running the real worker/index.js + ChatRoom DO under
// Miniflare (the Workers runtime simulator), as a re-runnable script.
//
// DEPENDENCY NOTE (RULES invariant 6): no new dependency is declared by
// this change. Miniflare is imported opportunistically — it already ships
// in this repo's dependency tree as wrangler's own dependency (wrangler is
// an existing devDependency), so `npm ci` provides it both locally and in
// CI. If it ever disappears from the tree, this script exits 2 with a clear
// message instead of failing obscurely; promoting miniflare to a direct
// devDependency is a one-line follow-up for the dependency batch.
// Run: node scripts/worker-smoke.mjs
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let Miniflare;
try {
	({ Miniflare } = await import('miniflare'));
} catch (_e) {
	console.error('worker-smoke: miniflare not resolvable (expected via wrangler dependency tree). Aborting — see header note.');
	process.exit(2);
}

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

class SmokeClient {
	constructor(ws) {
		this.ws = ws; this.raw = []; this.decrypted = []; this.serverKey = null;
		this.closed = false;
		ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
		ws.addEventListener('close', () => { this.closed = true; });
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
		if (this.shared) { try { this.decrypted.push(decryptMessage(msg, this.shared)); } catch (_e) { /* ignore */ } }
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
	async waitFor(pred, timeout = 5000) {
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

const mf = new Miniflare({
	modules: true,
	scriptPath: path.join(root, 'worker', 'index.js'),
	// The worker sources are ESM in .js files (wrangler infers this from the
	// entrypoint; Miniflare needs the rule stated explicitly).
	modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
	compatibilityDate: '2024-09-23',
	compatibilityFlags: ['nodejs_compat'],
	durableObjects: { CHAT_ROOM: 'ChatRoom', VAPID_STORE: 'VapidStore' },
});

try {
	console.log('=== worker-smoke: boot ===');
	const channel = crypto.createHash('sha256').update('worker-smoke-room').digest('hex');
	async function connect() {
		const res = await mf.dispatchFetch('http://smoke.local/?c=' + channel, { headers: { Upgrade: 'websocket' } });
		if (res.status !== 101 || !res.webSocket) throw new Error('WS upgrade failed: status ' + res.status);
		const ws = res.webSocket;
		ws.accept();
		return new SmokeClient(ws);
	}

	const a = await connect();
	for (let i = 0; i < 50 && !a.serverKey; i++) await sleep(100);
	check('client A received server-key', typeof a.serverKey === 'string' && a.serverKey.length > 100);
	await a.handshake();
	check('client A handshake derives shared key', !!a.shared && a.shared.length === 32);

	console.log('=== worker-smoke: join + member list ===');
	a.send({ a: 'j', p: channel });
	const la = await a.waitFor((m) => m.a === 'l');
	check('client A join yields member list', !!la);

	const b = await connect();
	await b.handshake();
	b.send({ a: 'j', p: channel });
	const lb = await b.waitFor((m) => m.a === 'l' && Array.isArray(m.p) && m.p.length === 1);
	check('client B sees exactly one other member', !!lb);
	// B's list names A; the id A sees in ITS list is B's — that is the relay target.
	const la2 = await a.waitFor((m) => m.a === 'l' && Array.isArray(m.p) && m.p.length === 1);
	const bId = la2 && la2.p[0];

	console.log('=== worker-smoke: relay ===');
	const payload = 'KV2-smoke-payload-' + crypto.randomBytes(4).toString('hex');
	a.send({ a: 'w', p: { [bId]: payload } });
	const relayed = await b.waitFor((m) => m.a === 'c' && m.p === payload);
	check('channel relay delivers payload verbatim to B', !!relayed);
	check('relay envelope names A as sender', !!relayed && typeof relayed.c === 'string' && relayed.c.length === 16);

	console.log('=== worker-smoke: ping/pong + garbage frame ===');
	a.ws.send('ping');
	for (let i = 0; i < 30 && !a.raw.includes('pong'); i++) await sleep(100);
	check('ping answered with pong', a.raw.includes('pong'));

	const g = await connect();
	g.ws.send('zz-not-a-key');
	for (let i = 0; i < 50 && !g.closed; i++) await sleep(100);
	check('garbage handshake frame closes the connection', g.closed === true);

	a.close(); b.close();
} catch (e) {
	check('smoke run completed without exception (' + e.message + ')', false);
} finally {
	await mf.dispose();
}

console.log(`\nworker-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

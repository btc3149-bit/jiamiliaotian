// Item 24: browser E2E — ONE main path only (by design, no UI matrix):
// two real browser pages join the same room against the local Node relay,
// A sends a text message, B's page must render the decrypted plaintext
// (which proves the full KV2 ratchet path in a real browser engine).
//
// Zero new dependencies (review ruling: no playwright/puppeteer):
// - the built client (dist/) is served by a tiny node:http static server
//   inside this script; the relay is the repo's own server/server.js;
// - the browser is driven over raw CDP using Node's built-in WebSocket.
// Browser discovery: $CHROME_PATH, /opt/meta-chromium/chrome (this repo's
// dev VM), then common PATH names. If no Chromium/Chrome exists the script
// exits 2 with a clear message — it is NOT part of the default `npm test`
// chain (it lives in scripts/, not test-*.mjs), so CI without a browser
// stays green; run it where a browser exists:
//   npm run build && node scripts/e2e-smoke.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
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

function findBrowser() {
	const candidates = [process.env.CHROME_PATH, '/opt/meta-chromium/chrome',
		'/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
	for (const c of candidates) if (c && fs.existsSync(c)) return c;
	for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
		try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch (_e) { /* next */ }
	}
	return null;
}

const browserPath = findBrowser();
if (!browserPath) {
	console.error('e2e-smoke: BLOCKED — no Chromium/Chrome binary found (set CHROME_PATH). Skipping E2E; see header.');
	process.exit(2);
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
	console.error('e2e-smoke: BLOCKED — dist/index.html missing. Run `npm run build` first.');
	process.exit(2);
}
if (!fs.existsSync(path.join(root, 'server', 'node_modules', 'ws'))) {
	console.error('e2e-smoke: BLOCKED — server deps missing. Run `cd server && npm ci --ignore-scripts`.');
	process.exit(2);
}

// ---- static server for dist/ ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' };
const staticSrv = http.createServer((req, res) => {
	const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	let file = path.join(root, 'dist', urlPath === '/' ? 'index.html' : urlPath);
	if (!file.startsWith(path.join(root, 'dist')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'dist', 'index.html');
	res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
	fs.createReadStream(file).pipe(res);
});
await new Promise((r) => staticSrv.listen(0, '127.0.0.1', r));
const webPort = staticSrv.address().port;

// ---- relay server ----
const WS_PORT = 18088;
const relay = spawn('node', ['server.js'], { cwd: path.join(root, 'server'), env: { ...process.env, PORT: String(WS_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let relayLog = '';
relay.stdout.on('data', (d) => { relayLog += d; });
relay.stderr.on('data', (d) => { relayLog += d; });

// ---- chromium via CDP ----
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jmlt-e2e-'));
const chrome = spawn(browserPath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeErr = '';
const devtoolsUrl = await new Promise((resolve, reject) => {
	const to = setTimeout(() => reject(new Error('chromium devtools timeout: ' + chromeErr.slice(-400))), 20000);
	chrome.stderr.on('data', (d) => {
		chromeErr += d;
		const m = chromeErr.match(/DevTools listening on (ws:\/\/\S+)/);
		if (m) { clearTimeout(to); resolve(m[1]); }
	});
}).catch((e) => {
	// e.g. the Hatch-gated /opt/meta-chromium build refuses CLI startup
	// ("WebGL domain policy is required") outside its managed harness.
	console.error('e2e-smoke: BLOCKED — browser found but did not start: ' + e.message);
	try { chrome.kill('SIGKILL'); } catch (_e) { /* ignore */ }
	relay.kill('SIGKILL'); staticSrv.close(); fs.rmSync(profile, { recursive: true, force: true });
	process.exit(2);
});

const cdp = await new Promise((resolve, reject) => {
	const ws = new WebSocket(devtoolsUrl);
	let seq = 0; const pending = new Map(); const sessions = new Map();
	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
	};
	ws.onopen = () => resolve({
		send(method, params = {}, sessionId) {
			return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
		},
	});
	ws.onerror = reject;
});

async function openPage(url) {
	const { browserContextId } = await cdp.send('Target.createBrowserContext');
	const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
	await cdp.send('Page.enable', {}, sessionId);
	await cdp.send('Runtime.enable', {}, sessionId);
	await cdp.send('Page.navigate', { url }, sessionId);
	return {
		sessionId,
		async eval(expr) {
			const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
			if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
			return r.result.value;
		},
		async waitFor(expr, timeout = 30000, label = expr) {
			const t0 = Date.now();
			while (Date.now() - t0 < timeout) { if (await this.eval(expr)) return true; await sleep(300); }
			throw new Error('waitFor timed out: ' + label);
		},
	};
}

const ROOM = 'e2e-room-' + Date.now();
const MARKER = 'KV2-E2E-PLAINTEXT-' + Math.random().toString(36).slice(2, 8);
try {
	for (let i = 0; i < 100 && !relayLog.includes('server started'); i++) await sleep(100);
	check('relay server started', relayLog.includes('server started'));

	const pageUrl = `http://127.0.0.1:${webPort}/?server=${encodeURIComponent('http://127.0.0.1:' + WS_PORT)}`;
	console.log('=== e2e-smoke: two pages join the same room ===');
	async function joinAs(name) {
		const page = await openPage(pageUrl);
		await page.waitFor(`!!document.getElementById('userName')`, 30000, 'login form');
		await page.eval(`(() => {
			const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
			set('userName', ${JSON.stringify(name)}); set('roomName', ${JSON.stringify(ROOM)}); set('password', 'e2e-smoke-password');
			document.getElementById('login-form').requestSubmit();
			return true; })()`);
		await page.waitFor(`document.getElementById('chat-container') && document.getElementById('chat-container').style.display !== 'none'`, 30000, 'chat container for ' + name);
		return page;
	}
	const pageA = await joinAs('alice-e2e');
	check('page A joined the room (chat UI visible)', true);
	const pageB = await joinAs('bob-e2e');
	check('page B joined the room (chat UI visible)', true);

	console.log('=== e2e-smoke: A sends, B renders decrypted plaintext ===');
	// Peer key exchange/ratchet setup may take a moment after both are in.
	await sleep(3000);
	await pageA.eval(`(() => {
		const input = document.querySelector('.input-message-input');
		input.focus(); document.execCommand('insertText', false, ${JSON.stringify(MARKER)});
		input.dispatchEvent(new Event('input', { bubbles: true }));
		return input.value || input.textContent; })()`);
	await pageA.eval(`document.querySelector('.send-message-btn').click()`);
	let received = false;
	try {
		await pageB.waitFor(`(document.getElementById('chat-area') || {}).textContent?.includes(${JSON.stringify(MARKER)})`, 45000, 'marker in B chat area');
		received = true;
	} catch (_e) {
		const dump = await pageB.eval(`(document.getElementById('chat-area') || { textContent: '(no chat area)' }).textContent.slice(0, 400)`);
		console.error('  B chat-area dump:', dump);
	}
	check('page B rendered the KV2-decrypted plaintext from A', received);
} catch (e) {
	check('e2e run completed without exception (' + e.message + ')', false);
} finally {
	try { chrome.kill('SIGKILL'); } catch (_e) { /* ignore */ }
	relay.kill('SIGKILL');
	staticSrv.close();
	fs.rmSync(profile, { recursive: true, force: true });
}

console.log(`\ne2e-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

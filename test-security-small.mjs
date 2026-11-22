// Security small-fixes batch (items 8/9/10/36-static/37/38):
// TOFU pin persistence warning, worker error logging, dead code/config,
// image src whitelist, release attestation wiring.
// 安全小修批测试（条目 8/9/10/36 静态锁/37/38）。
import { readFileSync } from 'node:fs';
import { sanitizeImageSrc } from './client/js/util.string.js';
import { logEvent as workerLogEvent } from './worker/utils.js';

let passed = 0, failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name); }
	else { failed++; console.log('  ✗ FAIL: ' + name); }
}
const read = (p) => readFileSync(p, 'utf8');

// ---------- item 37: sanitizeImageSrc whitelist ----------
console.log('=== test-security-small: sanitizeImageSrc (item 37) ===');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const WEBP = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBIAAAAvAAAAAA==';
check('valid png data URL passes unchanged', sanitizeImageSrc(PNG) === PNG);
check('valid webp data URL passes unchanged', sanitizeImageSrc(WEBP) === WEBP);
check('valid jpeg passes', sanitizeImageSrc('data:image/jpeg;base64,/9j/4AAQSkZJRg==') !== '');
check('valid gif passes', sanitizeImageSrc('data:image/gif;base64,R0lGODlhAQABAAAAACw=') !== '');
check('uppercase scheme/MIME passes', sanitizeImageSrc('DATA:IMAGE/PNG;BASE64,iVBORw0KGgo=') !== '');
check('svg+xml rejected (scriptable)', sanitizeImageSrc('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+') === '');
check('javascript: rejected', sanitizeImageSrc('javascript:alert(1)') === '');
check('whitespace-smuggled javascript: rejected', sanitizeImageSrc('  java\tscript:alert(1)') === '');
check('leading-whitespace valid URL still passes (trimmed)', sanitizeImageSrc('  ' + PNG + ' ') === PNG);
check('embedded space in payload rejected', sanitizeImageSrc('data:image/png;base64,iVBOR w0KGgo=') === '');
check('quote-breakout payload rejected', sanitizeImageSrc('data:image/png;base64,AAAA" onerror="alert(1)') === '');
check('remote https URL rejected', sanitizeImageSrc('https://evil.example/x.png') === '');
check('protocol-relative URL rejected', sanitizeImageSrc('//evil.example/x.png') === '');
check('data:text/html rejected', sanitizeImageSrc('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==') === '');
check('non-base64 data URL rejected', sanitizeImageSrc('data:image/png,<svg onload=alert(1)>') === '');
check('empty / non-string rejected', sanitizeImageSrc('') === '' && sanitizeImageSrc(null) === '' && sanitizeImageSrc(42) === '' && sanitizeImageSrc(undefined) === '');

const chatSrc = read('client/js/chat.js');
check('chat.js: all image sites use sanitizeImageSrc (>=6)', (chatSrc.match(/sanitizeImageSrc\(/g) || []).length >= 6);
check('chat.js: no image site keeps the old javascript:-strip pattern', !/safeImgSrc = escapeHTML\((?!sanitizeImageSrc)/.test(chatSrc));
check('chat.js: showImageModal escapes + sanitizes src', /showImageModal\(src\) \{[\s\S]{0,400}?escapeHTML\(sanitizeImageSrc\(src\)\)/.test(chatSrc));

// ---------- item 9: worker logEvent ----------
console.log('=== test-security-small: worker logEvent (item 9) ===');
{
	const lines = [];
	const orig = console.log;
	console.log = (...a) => lines.push(a.join(' '));
	try {
		workerLogEvent('someAction', new TypeError('SECRET-PAYLOAD-xyz'), 'error');
		workerLogEvent('someAction', 'debug detail', 'debug');
		workerLogEvent('someAction', 'info detail');
	} finally { console.log = orig; }
	check('error level is emitted', lines.length === 1);
	check('error line carries action + error type only', lines.length === 1 && lines[0].includes('someAction') && lines[0].includes('TypeError'));
	check('error line never leaks the error message/payload', lines.length === 1 && !lines[0].includes('SECRET-PAYLOAD-xyz'));
	check('debug/info stay silent', lines.length === 1);
}
const ncSrc = read('client/js/NodeCrypt.js');
check('NodeCrypt:245 server-key catch logs (no empty catch left)', !ncSrc.includes('catch (e) {}') && ncSrc.includes("logEvent('onMessage-serverkey'"));

// ---------- item 10: dead code / dead config ----------
console.log('=== test-security-small: dead code/config (item 10) ===');
const viteCfg = read('vite.config.js');
check('vite.config: no aes-js / js-chacha20 left', !viteCfg.includes('aes-js') && !viteCfg.includes('js-chacha20'));
check('vite.config: live deps kept (elliptic/js-sha256)', viteCfg.includes('elliptic') && viteCfg.includes('js-sha256'));
check('worker/utils.js: isArray export removed', !read('worker/utils.js').includes('isArray'));
check('server/server.js: inline isArray removed', !read('server/server.js').includes('isArray'));
const pkg = JSON.parse(read('package.json'));
check('package.json: wrangler scripts have no leading space', ['dev', 'deploy', 'publish'].every(k => pkg.scripts[k] === pkg.scripts[k].trim() && pkg.scripts[k].length > 0));
check('package.json: publish uses wrangler deploy (publish removed in wrangler 4)', pkg.scripts.publish === 'wrangler deploy');

// ---------- item 36 static red line ----------
console.log('=== test-security-small: PBKDF2 red line (item 36) ===');
check('NodeCrypt main derivation untouched at 200000 (interop red line)', ncSrc.includes('iterations: 200000'));

// ---------- item 38: release attestation wiring ----------
console.log('=== test-security-small: release attestation (item 38) ===');
const desktopYml = read('.github/workflows/desktop.yml');
check('desktop.yml: uses actions/attest-build-provenance', desktopYml.includes('actions/attest-build-provenance'));
check('desktop.yml: grants id-token + attestations write', desktopYml.includes('id-token: write') && desktopYml.includes('attestations: write'));
check('desktop.yml: generates SHA256SUMS attached to release', desktopYml.includes('SHA256SUMS-windows.txt') && desktopYml.includes('SHA256SUMS-linux.txt') && desktopYml.includes('SHA256SUMS-macos-'));
check('desktop.yml: ci.yml untouched by this batch (no attestation leak)', !read('.github/workflows/ci.yml').includes('attest-build-provenance'));
const desktopReadme = read('desktop/README.md');
check('desktop/README: unsigned-install warnings + bypass for 3 platforms', desktopReadme.includes('SmartScreen') && desktopReadme.includes('Gatekeeper') && desktopReadme.includes('chmod +x'));
check('desktop/README: checksum + attestation verify documented', desktopReadme.includes('SHA256SUMS') && desktopReadme.includes('gh attestation verify'));

// ---------- item 8: TOFU pin persistence warning ----------
console.log('=== test-security-small: pin persist warning (item 8) ===');
const i18nSrc = read('client/js/util.i18n.js');
check('i18n: security.pin_persist_failed present in both locales', (i18nSrc.split("'security.pin_persist_failed'").length - 1) === 2);
check('NodeCrypt: notifyPinPersistFailed wired at >=4 pin sites', (ncSrc.match(/notifyPinPersistFailed\(\)/g) || []).length >= 4);
check('NodeCrypt: onPinPersistFailed callback registered', ncSrc.includes('onPinPersistFailed: callbacks.onPinPersistFailed'));

globalThis.window = globalThis; // NodeCrypt assigns window.Buffer at import
globalThis.localStorage = {
	getItem() { throw new Error('denied'); },
	setItem() { throw new Error('denied'); },
	removeItem() {}
};
const { build } = await import('esbuild');
await build({
	entryPoints: ['client/js/NodeCrypt.js'],
	bundle: true, format: 'esm', platform: 'node',
	banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
	outfile: '.tmp-nodecrypt-sec.mjs', logLevel: 'silent'
});
const { NodeCrypt } = await import('./.tmp-nodecrypt-sec.mjs');
{
	let calls = 0, lastMsg = '';
	const nc = new NodeCrypt({}, { onPinPersistFailed: (m) => { calls++; lastMsg = m; } });
	nc.credentials = { username: 'u', channel: 'roomhash', password: 'x' };
	const ok1 = await nc.handleServerKey({ key: 'FAKESERVERKEY1' });
	check('pin failure does not change flow (first connect still succeeds)', ok1 === true && nc.config.rsaPublic === 'FAKESERVERKEY1');
	check('warning fired exactly once despite read+write both failing', calls === 1);
	check('warning message comes from i18n key (session-only wording)', typeof lastMsg === 'string' && lastMsg.includes('session only'));
	const ok2 = await nc.handleServerKey({ key: 'FAKESERVERKEY1' });
	check('warning stays one-shot across repeated failures', ok2 === true && calls === 1);
}
{
	let alerts = 0;
	globalThis.alert = () => { alerts++; };
	const nc2 = new NodeCrypt({}, {});
	nc2.credentials = { username: 'u', channel: 'roomhash', password: 'x' };
	await nc2.handleServerKey({ key: 'FAKESERVERKEY2' });
	check('no callback -> native alert fallback fires once', alerts === 1);
	delete globalThis.alert;
}
{
	// Healthy storage: pin persists, no warning.
	const store = new Map();
	globalThis.localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k)
	};
	let calls = 0;
	const nc3 = new NodeCrypt({}, { onPinPersistFailed: () => { calls++; } });
	nc3.credentials = { username: 'u', channel: 'roomhash', password: 'x' };
	const ok = await nc3.handleServerKey({ key: 'FAKESERVERKEY3' });
	check('healthy storage: pin written, no warning', ok === true && calls === 0 && [...store.values()].includes('FAKESERVERKEY3'));
}

console.log(`\ntest-security-small: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

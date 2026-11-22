// Item 23: dual-implementation contract tests (worker/ vs server/).
// worker/ and server/ are two hand-copied implementations of the same relay
// logic. This test feeds ONE vector set to both sides and asserts identical
// behaviour, so drift fails CI instead of being caught by hand.
//
// HOW each side is exercised:
// - worker side: real imports (worker/utils.js, worker/ratelimit.js are
//   pure ES modules).
// - server side: server/server.js is NOT importable (it boots a server on
//   load), so its inline copies are extracted VERBATIM from the source text
//   (brace-matched) and evaluated in a sandbox with the same stubs
//   (crypto, RL, hsIpMap, logEvent). This is function-level verification —
//   noted as such. Black-box equivalence for the Node server is covered by
//   test-server-integration.mjs; for the Worker by scripts/worker-smoke.mjs.
// If an extraction marker disappears (function renamed/reshaped), this test
// fails loudly rather than silently skipping — that is intentional.
// Run: node test-contract.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as wUtils from './worker/utils.js';
import * as wRl from './worker/ratelimit.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

const serverSrc = fs.readFileSync(new URL('./server/server.js', import.meta.url), 'utf8');
const workerSrc = fs.readFileSync(new URL('./worker/index.js', import.meta.url), 'utf8');

// Brace-matched extraction of `const <name> = (...) => { ... };` from source.
function extractArrow(src, name) {
	const start = src.indexOf(`const ${name} = `);
	if (start < 0) throw new Error(`contract: cannot find ${name} in server source`);
	const braceStart = src.indexOf('{', src.indexOf('=>', start));
	let depth = 0;
	for (let i = braceStart; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 2); }
	}
	throw new Error(`contract: unbalanced braces for ${name}`);
}
function extractLiteral(src, name) {
	const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
	if (!m) throw new Error(`contract: cannot find literal ${name}`);
	return m[1].trim();
}

// ---- Build the server-side sandbox ----
const RL = new Function(`return (${extractLiteral(serverSrc, 'RL')});`)();
const serverSandbox = { crypto, RL, hsIpMap: new Map(), logEvent: () => {} };
{
	const names = ['encryptMessage', 'decryptMessage', 'isString', 'isArray', 'isObject', 'generateClientId', 'rlBucketAllow', 'rlByteWindowAllow', 'rlIpHandshakeAllow', 'rlIpHandshakeCount'];
	const code = names.map((n) => extractArrow(serverSrc, n)).join('\n')
		+ `\nreturn { ${names.join(', ')} };`;
	const factory = new Function('crypto', 'RL', 'hsIpMap', 'logEvent', code);
	Object.assign(serverSandbox, factory(crypto, RL, serverSandbox.hsIpMap, () => {}));
}
const sUtils = serverSandbox;

console.log('=== test-contract: rate-limit constants (worker exports vs server RL) ===');
{
	const pairs = [
		['maxFrameBytes', wRl.MAX_FRAME_BYTES], ['bucketCapacity', wRl.RATE_BUCKET_CAPACITY],
		['refillPerSec', wRl.RATE_REFILL_PER_SEC], ['maxViolations', wRl.RATE_MAX_VIOLATIONS],
		['byteWindowMs', wRl.BYTE_WINDOW_MS], ['byteWindowMax', wRl.BYTE_WINDOW_MAX],
		['maxFanout', wRl.MAX_FANOUT], ['maxChannelMembers', wRl.MAX_CHANNEL_MEMBERS],
		['maxConnectionsGlobal', wRl.MAX_CONNECTIONS_GLOBAL], ['maxConnectionsPerIp', wRl.MAX_CONNECTIONS_PER_IP],
		['maxHandshakesPerConnection', wRl.MAX_HANDSHAKES_PER_CONNECTION], ['maxHandshakesPerIp', wRl.MAX_HANDSHAKES_PER_IP],
		['handshakeWindowMs', wRl.HANDSHAKE_WINDOW_MS], ['ipMapMaxEntries', wRl.IP_MAP_MAX_ENTRIES],
	];
	for (const [key, wVal] of pairs) check(`RL.${key} matches worker constant (${wVal})`, RL[key] === wVal);
}

console.log('=== test-contract: handshake frame shape vectors ===');
{
	const sRe = new Function(`return (${extractLiteral(serverSrc, 'HANDSHAKE_FRAME_RE')});`)();
	const real = (() => { const e = crypto.createECDH('secp384r1'); e.generateKeys(); return e.getPublicKey('hex', 'uncompressed'); })();
	const vectors = [real, real.toUpperCase(), real.slice(0, 100), real + 'ab', 'zz' + real.slice(2), '', 'ping', real.replace('04', '05')];
	let allSame = true;
	for (const v of vectors) if (wRl.isHandshakeFrame(v) !== sRe.test(v)) allSame = false;
	check('worker isHandshakeFrame === server HANDSHAKE_FRAME_RE on 8 vectors', allSame);
	check('worker HANDSHAKE_FRAME_RE source identical to server', String(wRl.HANDSHAKE_FRAME_RE) === String(sRe));
}

console.log('=== test-contract: channel name validation vectors ===');
{
	// Both sides gate joins with /^[0-9a-f]{64}$/ (worker/index.js twice,
	// server/server.js in the join handler). Extract each literal and run
	// the same vectors through all of them.
	const grab = (src) => [...src.matchAll(/\/\^\[0-9a-f\]\{64\}\$\//g)].map((m) => m[0]);
	const wRes = grab(workerSrc); const sRes = grab(serverSrc);
	check('channel regex present on both sides', wRes.length >= 1 && sRes.length >= 1);
	const res = [...wRes, ...sRes].map((lit) => new Function(`return (${lit});`)());
	const good = 'a'.repeat(64); const goodHex = '0123456789abcdef'.repeat(4);
	const vectors = [good, goodHex, 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '', 'room-name', good + '\n'];
	let consistent = true;
	for (const v of vectors) { const first = res[0].test(v); if (!res.every((r) => r.test(v) === first)) consistent = false; }
	check('all channel regex copies agree on 9 vectors', consistent);
	check('valid 64-hex accepted, uppercase rejected', res[0].test(goodHex) && !res[0].test('A'.repeat(64)));
}

console.log('=== test-contract: token bucket / byte window behaviour ===');
{
	const now = 5000000;
	const wb = wRl.createBucket(now);
	const sb = { tokens: RL.bucketCapacity, last: now, violations: 0 };
	let same = true;
	for (let i = 0; i < wRl.RATE_BUCKET_CAPACITY + wRl.RATE_MAX_VIOLATIONS + 2; i++) {
		const a = wRl.bucketAllow(wb, now); const b = sUtils.rlBucketAllow(sb, now);
		if (a.allow !== b.allow || a.shouldClose !== b.shouldClose) same = false;
	}
	check('bucket drain + violation/close sequence identical', same);
	const wb2 = wRl.createBucket(now); const sb2 = { tokens: RL.bucketCapacity, last: now, violations: 0 };
	for (let i = 0; i < wRl.RATE_BUCKET_CAPACITY; i++) { wRl.bucketAllow(wb2, now); sUtils.rlBucketAllow(sb2, now); }
	const later = now + 1000;
	check('bucket refill after 1s identical', JSON.stringify(wRl.bucketAllow(wb2, later)) === JSON.stringify(sUtils.rlBucketAllow(sb2, later)));
	const ww = wRl.createByteWindow(now); const sw = { start: now, bytes: 0 };
	const seq = [100, wRl.BYTE_WINDOW_MAX, 1, 50];
	let wSame = true;
	for (const n of seq) if (wRl.byteWindowAllow(ww, n, now) !== sUtils.rlByteWindowAllow(sw, n, now)) wSame = false;
	if (wRl.byteWindowAllow(ww, 10, now + wRl.BYTE_WINDOW_MS + 1) !== sUtils.rlByteWindowAllow(sw, 10, now + wRl.BYTE_WINDOW_MS + 1)) wSame = false;
	check('byte window accept/deny/reset sequence identical', wSame);
	// per-IP handshake window: worker takes an explicit map, server a closed-over one.
	const map = new Map();
	let ipSame = true;
	for (let i = 0; i < wRl.MAX_HANDSHAKES_PER_IP + 2; i++) {
		if (wRl.ipHandshakeAllow(map, '198.51.100.7', now) !== sUtils.rlIpHandshakeAllow('198.51.100.7', now)) ipSame = false;
	}
	check('per-IP handshake window sequence identical', ipSame);
	check('per-IP handshake count identical', wRl.ipHandshakeCount(map, '198.51.100.7', now) === sUtils.rlIpHandshakeCount('198.51.100.7', now));
}

console.log('=== test-contract: encryptMessage/decryptMessage cross-implementation ===');
{
	const key = crypto.randomBytes(32);
	const msgs = [{ a: 'm', t: 'text', d: 'hello 契约' }, { a: 'j', p: 'a'.repeat(64) }, { n: 42, arr: [1, 2, 3] }, 'plain-string', 7, null, { nested: { deep: [true, null] } }];
	let crossOk = true;
	for (const m of msgs) {
		const wWire = wUtils.encryptMessage(m, key);
		const sWire = sUtils.encryptMessage(m, key);
		if (JSON.stringify(sUtils.decryptMessage(wWire, key)) !== JSON.stringify(m === null ? {} : m) && JSON.stringify(sUtils.decryptMessage(wWire, key)) !== JSON.stringify(m)) crossOk = false;
		if (JSON.stringify(wUtils.decryptMessage(sWire, key)) !== JSON.stringify(sUtils.decryptMessage(sWire, key))) crossOk = false;
	}
	check('worker-encrypt → server-decrypt and server-encrypt → worker-decrypt agree on 7 vectors', crossOk);
	const wire = wUtils.encryptMessage({ a: 'm', d: 'tamper-me' }, key);
	const parts = wire.split('|');
	const sealed = Buffer.from(parts[1], 'base64'); sealed[sealed.length - 1] ^= 0xff;
	const forged = parts[0] + '|' + sealed.toString('base64');
	check('tampered frame rejected identically ({} both sides)',
		JSON.stringify(wUtils.decryptMessage(forged, key)) === '{}' && JSON.stringify(sUtils.decryptMessage(forged, key)) === '{}');
	const wrongKey = crypto.randomBytes(32);
	check('wrong key rejected identically ({} both sides)',
		JSON.stringify(wUtils.decryptMessage(wire, wrongKey)) === '{}' && JSON.stringify(sUtils.decryptMessage(wire, wrongKey)) === '{}');
	check('garbage frame rejected identically',
		JSON.stringify(wUtils.decryptMessage('not-a-frame', key)) === JSON.stringify(sUtils.decryptMessage('not-a-frame', key)));
}

console.log('=== test-contract: type guards + clientId ===');
{
	const vals = ['x', '', [], [1], {}, { a: 1 }, null, undefined, 0, 42, true];
	const same = (fnW, fnS) => vals.every((v) => fnW(v) === fnS(v));
	check('isString agrees', same(wUtils.isString, sUtils.isString));
	check('isArray agrees', same(wUtils.isArray, sUtils.isArray));
	check('isObject agrees', same(wUtils.isObject, sUtils.isObject));
	check('generateClientId shape agrees (16 hex)', /^[0-9a-f]{16}$/.test(wUtils.generateClientId()) && /^[0-9a-f]{16}$/.test(sUtils.generateClientId()));
}

console.log('=== test-contract: frame size cap ===');
check('frame cap constant equal both sides', wRl.MAX_FRAME_BYTES === RL.maxFrameBytes && wRl.MAX_FRAME_BYTES === 8 * 1024 * 1024);
check('server ws maxPayload wired to the same cap', serverSrc.includes('maxPayload: RL.maxFrameBytes'));

console.log(`\ntest-contract: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

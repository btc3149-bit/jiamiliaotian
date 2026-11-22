// Pure-function rate-limit tests (X-2, PR-4) for worker/ratelimit.js.
// Assertions are relative to the exported constants — no limit values are
// hard-coded here, so owner tuning does not require test edits.
// 限流纯函数测试：断言一律相对导出常量边界，不硬编码数值。
// Run: node test-ratelimit.mjs
import crypto from 'node:crypto';
import {
	createBucket, bucketAllow, createByteWindow, byteWindowAllow,
	ipHandshakeAllow, ipHandshakeCount, isHandshakeFrame,
	RATE_BUCKET_CAPACITY, RATE_REFILL_PER_SEC, RATE_MAX_VIOLATIONS,
	BYTE_WINDOW_MS, BYTE_WINDOW_MAX, MAX_HANDSHAKES_PER_IP, HANDSHAKE_WINDOW_MS
} from './worker/ratelimit.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

console.log('=== test-ratelimit: token bucket ===');
{
	const now = 1000000;
	const b = createBucket(now);
	let allowed = 0;
	for (let i = 0; i < RATE_BUCKET_CAPACITY; i++) if (bucketAllow(b, now).allow) allowed++;
	check('full bucket allows exactly capacity frames at once', allowed === RATE_BUCKET_CAPACITY);
	const denied = bucketAllow(b, now);
	check('frame beyond capacity is denied', denied.allow === false);
	let closedAt = -1;
	const b2 = createBucket(now);
	b2.tokens = 0;
	for (let i = 1; i <= RATE_MAX_VIOLATIONS; i++) {
		const v = bucketAllow(b2, now);
		if (v.shouldClose) { closedAt = i; break; }
	}
	check('shouldClose fires exactly at max violations', closedAt === RATE_MAX_VIOLATIONS);
	const b3 = createBucket(now);
	b3.tokens = 0;
	const later = now + (1 / RATE_REFILL_PER_SEC) * 1000 + 1;
	check('one refill interval restores a frame', bucketAllow(b3, later).allow === true);
	const b4 = createBucket(now);
	for (let i = 0; i < RATE_BUCKET_CAPACITY * 3; i++) bucketAllow(b4, now + i * 100);
	check('bucket never exceeds capacity after refill', b4.tokens <= RATE_BUCKET_CAPACITY);
}

console.log('=== test-ratelimit: byte window ===');
{
	const now = 2000000;
	const w = createByteWindow(now);
	check('window allows up to the max', byteWindowAllow(w, BYTE_WINDOW_MAX, now) === true);
	const w2 = createByteWindow(now);
	check('window denies one byte over the max', byteWindowAllow(w2, BYTE_WINDOW_MAX + 1, now) === false);
	const w3 = createByteWindow(now);
	byteWindowAllow(w3, BYTE_WINDOW_MAX + 1, now);
	check('window resets after its span', byteWindowAllow(w3, 100, now + BYTE_WINDOW_MS + 1) === true);
}

console.log('=== test-ratelimit: per-IP handshake window ===');
{
	const now = 3000000;
	const map = new Map();
	let allowed = 0;
	for (let i = 0; i < MAX_HANDSHAKES_PER_IP; i++) if (ipHandshakeAllow(map, '203.0.113.1', now)) allowed++;
	check('allows exactly the per-IP handshake limit', allowed === MAX_HANDSHAKES_PER_IP);
	check('next attempt in window is denied', ipHandshakeAllow(map, '203.0.113.1', now) === false);
	check('a different IP is unaffected', ipHandshakeAllow(map, '203.0.113.2', now) === true);
	check('count reflects attempts', ipHandshakeCount(map, '203.0.113.1', now) === MAX_HANDSHAKES_PER_IP + 1);
	check('window resets after its span', ipHandshakeAllow(map, '203.0.113.1', now + HANDSHAKE_WINDOW_MS + 1) === true);
}

console.log('=== test-ratelimit: handshake frame shape (S-2) ===');
{
	const ecdh = crypto.createECDH('secp384r1');
	ecdh.generateKeys();
	const real = ecdh.getPublicKey('hex', 'uncompressed');
	check('real client public key passes (194 hex, 04 prefix)', real.length === 194 && isHandshakeFrame(real));
	check('uppercase hex passes', isHandshakeFrame(real.toUpperCase()));
	check('short frame rejected', !isHandshakeFrame(real.slice(0, 100)));
	check('long frame rejected', !isHandshakeFrame(real + 'ab'));
	check('wrong prefix rejected', !isHandshakeFrame('05' + real.slice(2)));
	check('non-hex rejected', !isHandshakeFrame('zz' + real.slice(2)));
	check('empty rejected', !isHandshakeFrame(''));
	check('non-string rejected', !isHandshakeFrame(null) && !isHandshakeFrame(42));
}

console.log(`\ntest-ratelimit: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

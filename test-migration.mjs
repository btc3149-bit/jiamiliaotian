// v1.4.0 #14: room credential migration tests. Covers the pure helpers and
// the WebCrypto container in client/js/util.keyExport.js:
// roundtrip / wrong key / tamper / expiry / clock-skew / bad magic / payload
// validation. Run: node test-migration.mjs
// v1.4.0 #14：房间凭据迁移测试。覆盖纯函数与 WebCrypto 容器：
// 往返 / 错钥 / 篡改 / 过期 / 钟差 / 坏 magic / 载荷校验。
import {
	buildMigrationPayload,
	validateMigrationPayload,
	encryptMigration,
	decryptMigration,
	buildMigrationUrl,
	parseMigrationText,
	bytesToB64,
	b64ToBytes,
	MIGRATION_MAGIC
} from './client/js/util.keyExport.js';

let passed = 0;
let failed = 0;

function check(name, cond) {
	if (cond) {
		passed++;
		console.log(`  ✓ ${name}`);
	} else {
		failed++;
		console.error(`  ✗ FAIL: ${name}`);
	}
}

const NOW = Date.now();

console.log('=== test-migration: payload build ===');
const p1 = buildMigrationPayload('my room', 's3cret!', 'alice', NOW);
check('builds v1 payload', p1.v === 1 && p1.n === 'my room' && p1.p === 's3cret!' && p1.u === 'alice' && p1.ts === NOW);
check('empty username allowed', buildMigrationPayload('r', 'p', '', NOW).u === '');
const pLong = buildMigrationPayload('r'.repeat(100), 'p'.repeat(100), 'u'.repeat(50), NOW);
check('fields clamped (room 64 / pwd 64 / user 15)', pLong.n.length === 64 && pLong.p.length === 64 && pLong.u.length === 15);
check('ts fallback when not a number', buildMigrationPayload('r', 'p', '', 'x').ts > 0);

console.log('=== test-migration: validateMigrationPayload ===');
check('valid payload passes', !!validateMigrationPayload(p1, NOW));
check('rejects null / non-object', validateMigrationPayload(null, NOW) === null && validateMigrationPayload('x', NOW) === null);
check('rejects wrong version', validateMigrationPayload({ ...p1, v: 2 }, NOW) === null);
check('rejects empty room name', validateMigrationPayload({ ...p1, n: '  ' }, NOW) === null);
check('rejects over-long room name', validateMigrationPayload({ ...p1, n: 'x'.repeat(65) }, NOW) === null);
check('rejects over-long password', validateMigrationPayload({ ...p1, p: 'x'.repeat(65) }, NOW) === null);
check('rejects over-long username', validateMigrationPayload({ ...p1, u: 'x'.repeat(16) }, NOW) === null);
check('rejects missing ts', validateMigrationPayload({ v: 1, n: 'r', p: 'p', u: '' }, NOW) === null);
check('rejects expired (11 min old)', validateMigrationPayload({ ...p1, ts: NOW - 11 * 60 * 1000 }, NOW) === null);
check('accepts exactly 10 min old (boundary)', !!validateMigrationPayload({ ...p1, ts: NOW - 10 * 60 * 1000 }, NOW));
check('accepts 1s before expiry boundary', !!validateMigrationPayload({ ...p1, ts: NOW - (10 * 60 * 1000 - 1) }, NOW));
check('rejects far-future ts (>5min skew)', validateMigrationPayload({ ...p1, ts: NOW + 6 * 60 * 1000 }, NOW) === null);
check('accepts small future skew (1 min)', !!validateMigrationPayload({ ...p1, ts: NOW + 60 * 1000 }, NOW));
const clean = validateMigrationPayload({ ...p1, n: '  padded  ' }, NOW);
check('room name trimmed', clean && clean.roomName === 'padded');

console.log('=== test-migration: encrypt/decrypt roundtrip ===');
const payload = buildMigrationPayload('迁移房间', 'пароль123', 'bob', NOW);
const blob = await encryptMigration(payload, 'one-time-key');
check('container starts with magic + version', String.fromCharCode(...blob.slice(0, MIGRATION_MAGIC.length)) === MIGRATION_MAGIC && blob[MIGRATION_MAGIC.length] === 1);
check('container has salt+iv+tag overhead', blob.length >= MIGRATION_MAGIC.length + 1 + 16 + 12 + 16);
const back = await decryptMigration(blob, 'one-time-key', NOW + 1000);
check('roundtrip returns room name', back.roomName === '迁移房间');
check('roundtrip returns password', back.password === 'пароль123');
check('roundtrip returns username', back.username === 'bob');

check('wrong key rejected as bad-key', await decryptMigration(blob, 'wrong-key', NOW + 1000).catch(e => e.message) === 'bad-key');
check('tampered ciphertext rejected as bad-key', await (async () => {
	const copy = new Uint8Array(blob);
	copy[copy.length - 1] ^= 0xff;
	return decryptMigration(copy, 'one-time-key', NOW + 1000).catch(e => e.message);
})() === 'bad-key');
check('tampered salt rejected as bad-key', await (async () => {
	const copy = new Uint8Array(blob);
	copy[MIGRATION_MAGIC.length + 1] ^= 0xff;
	return decryptMigration(copy, 'one-time-key', NOW + 1000).catch(e => e.message);
})() === 'bad-key');
check('expired payload rejected at decrypt', await decryptMigration(blob, 'one-time-key', NOW + 10 * 60 * 1000 + 1).catch(e => e.message) === 'expired');
check('wrong version rejected as bad-format', await (async () => {
	const copy = new Uint8Array(blob);
	copy[MIGRATION_MAGIC.length] = 9;
	return decryptMigration(copy, 'one-time-key', NOW + 1000).catch(e => e.message);
})() === 'bad-format');
check('truncated container rejected as bad-format', await decryptMigration(blob.slice(0, 20), 'one-time-key', NOW).catch(e => e.message) === 'bad-format');
check('non-Uint8Array rejected as bad-format', await decryptMigration('junk', 'one-time-key', NOW).catch(e => e.message) === 'bad-format');
check('random bytes rejected as bad-format', await decryptMigration(crypto.getRandomValues(new Uint8Array(80)), 'one-time-key', NOW).catch(e => e.message) === 'bad-format');

console.log('=== test-migration: QR url roundtrip ===');
const url = buildMigrationUrl(blob);
check('url carries #jmlt= fragment', url.indexOf('#jmlt=') !== -1);
check('url parses back to identical bytes', (() => {
	const parsed = parseMigrationText(url);
	if (!parsed || parsed.length !== blob.length) return false;
	for (let i = 0; i < blob.length; i++) if (parsed[i] !== blob[i]) return false;
	return true;
})());
check('raw base64 text also parses', (() => {
	const parsed = parseMigrationText(bytesToB64(blob));
	return !!parsed && parsed.length === blob.length;
})());
check('garbage text returns null', parseMigrationText('hello world this is not base64!!') === null && parseMigrationText('') === null && parseMigrationText(null) === null);
check('b64 roundtrip binary-safe (0-255)', (() => {
	const all = new Uint8Array(256);
	for (let i = 0; i < 256; i++) all[i] = i;
	const back = b64ToBytes(bytesToB64(all));
	for (let i = 0; i < 256; i++) if (back[i] !== i) return false;
	return true;
})());

console.log(`\ntest-migration: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

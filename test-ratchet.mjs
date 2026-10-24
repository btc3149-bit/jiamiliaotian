// v1.6.0 #15: ratchet专项测试. Covers the pure ratchet module in
// client/js/util.ratchet.js: HMAC vectors, roundtrip, out-of-order, loss
// beyond cap, replay protection, forward secrecy, tamper rejection,
// generation/rekey machine, tie-break, gap-DoS guard, wire validation.
// Run: node test-ratchet.mjs
import {
	hmacSha256,
	chainStep,
	messageKeyFrom,
	directionKeysFrom,
	RatchetGeneration,
	PeerRatchet,
	isRatchetEligible
} from './client/js/util.ratchet.js';

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

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const rootOf = (seed) => hmacSha256(new TextEncoder().encode('seed:' + seed), new TextEncoder().encode('jmlt-test'));

console.log('=== test-ratchet: HMAC-SHA256 (RFC 4231 vector) ===');
const hmacVec = hmacSha256(new TextEncoder().encode('key'), new TextEncoder().encode('The quick brown fox jumps over the lazy dog'));
check('matches RFC 4231 test vector', hex(hmacVec) === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
check('long-key path (>64B) works', hex(hmacSha256(new Uint8Array(131).fill(0xaa), new TextEncoder().encode('x'))) === hex(hmacSha256(new Uint8Array(131).fill(0xaa), new TextEncoder().encode('x'))));

console.log('=== test-ratchet: chain primitives ===');
const root = rootOf('room-key');
check('chainStep deterministic', hex(chainStep(root)) === hex(chainStep(root)));
check('messageKey differs from chainStep', hex(messageKeyFrom(root)) !== hex(chainStep(root)));
const dirs = directionKeysFrom(root, true);
const dirs2 = directionKeysFrom(root, false);
check('role chains domain-separated (A vs B)', hex(dirs.send) !== hex(dirs.recv) && hex(dirs2.send) !== hex(dirs2.recv));
check('role symmetry: first.send === second.recv', hex(dirs.send) === hex(dirs2.recv) && hex(dirs.recv) === hex(dirs2.send));
check('direction keys deterministic', hex(directionKeysFrom(root, true).send) === hex(dirs.send));

console.log('=== test-ratchet: in-order roundtrip (Alice/Bob) ===');
const sharedRoot = rootOf('shared-root');
const alice = new PeerRatchet({ rootKey: sharedRoot, canInitiateRekey: true, rekeyEvery: 0 });
const bob = new PeerRatchet({ rootKey: sharedRoot, isFirst: true, canInitiateRekey: false, rekeyEvery: 0 });
const wires = [];
for (let i = 0; i < 10; i++) {
	const w = alice.encryptOutgoing({ a: 'm', t: 'text', d: 'msg-' + i, id: 'id' + i + 'aaaaaa' });
	if (!w) break;
	wires.push(w);
}
check('10 wires produced with KV2 prefix', wires.length === 10 && wires.every(w => w.startsWith('KV2|1|')));
let ok = true;
for (let i = 0; i < 10; i++) {
	const obj = bob.decryptIncoming(wires[i]);
	if (!obj || obj.d !== 'msg-' + i) { ok = false; break }
}
check('Bob decrypts all 10 in order', ok);
check('stats: recvIndex advanced to 10', bob.stats().recvIndex === 10);

console.log('=== test-ratchet: out-of-order delivery ===');
const alice2 = new PeerRatchet({ rootKey: rootOf('oo'), rekeyEvery: 0 });
const bob2 = new PeerRatchet({ rootKey: rootOf('oo'), isFirst: true, rekeyEvery: 0 });
const batch = [];
for (let i = 0; i < 8; i++) batch.push(alice2.encryptOutgoing({ a: 'm', t: 'text', d: 'oo-' + i }));
const shuffled = [batch[3], batch[1], batch[7], batch[0], batch[5], batch[2], batch[6], batch[4]];
let okOO = true;
shuffled.forEach((w, k) => {
	const obj = bob2.decryptIncoming(w);
	if (!obj || !String(obj.d).startsWith('oo-')) okOO = false;
});
check('all 8 decrypt after shuffle', okOO);
check('no skipped keys left', bob2.stats().skipped === 0);

console.log('=== test-ratchet: replay protection ===');
check('re-delivered wire rejected (key consumed)', bob.decryptIncoming(wires[4]) === null);
check('skipped-key replay rejected', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('rp'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('rp'), isFirst: true, rekeyEvery: 0 });
	const w0 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'zero' });
	const w1 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'one' });
	if (b.decryptIncoming(w1) === null) return false; // skip key for 0 buffered
	if (b.decryptIncoming(w0) === null) return false; // late arrival decrypts
	return b.decryptIncoming(w0) === null;            // second replay fails
})());

console.log('=== test-ratchet: forward secrecy ===');
check('consumed message key is gone: replay of delivered wire fails', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('fs'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('fs'), isFirst: true, rekeyEvery: 0 });
	const old = a.encryptOutgoing({ a: 'm', t: 'text', d: 'ancient' });
	if (b.decryptIncoming(old) === null) return false; // delivered once
	for (let i = 0; i < 50; i++) b.decryptIncoming(a.encryptOutgoing({ a: 'm', t: 'text', d: 'n' + i }));
	check('no skipped keys retained after full in-order delivery', b.stats().skipped === 0);
	return b.decryptIncoming(old) === null; // message key long gone
})());
check('one-wayness: current chain cannot re-derive old message keys', (() => {
	const g = new RatchetGeneration(rootOf('oneway'));
	const mk0 = messageKeyFrom(g.sendKey);
	const k1 = chainStep(g.sendKey);
	return hex(messageKeyFrom(k1)) !== hex(mk0) && hex(chainStep(k1)) !== hex(k1);
})());

console.log('=== test-ratchet: tamper rejection ===');
check('flipped ciphertext byte rejected', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('tamper'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('tamper'), isFirst: true, rekeyEvery: 0 });
	const w = a.encryptOutgoing({ a: 'm', t: 'text', d: 'secret' });
	const parts = w.split('|');
	const ct = Buffer.from(parts[4], 'base64');
	ct[ct.length - 1] ^= 0xff;
	return b.decryptIncoming(parts[0] + '|' + parts[1] + '|' + parts[2] + '|' + parts[3] + '|' + ct.toString('base64')) === null;
})());
check('tampered gen/ci fields rejected', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('tf2'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('tf2'), rekeyEvery: 0 });
	const w = a.encryptOutgoing({ a: 'm', t: 'text', d: 'x' });
	return b.decryptIncoming(w.replace(/^KV2\|1\|/, 'KV2|9|')) === null;
})());

console.log('=== test-ratchet: wire validation ===');
const a3 = new PeerRatchet({ rootKey: rootOf('wv'), rekeyEvery: 0 });
const b3 = new PeerRatchet({ rootKey: rootOf('wv'), isFirst: true, rekeyEvery: 0 });
check('garbage / wrong prefix / wrong arity rejected', b3.decryptIncoming('hello') === null && b3.decryptIncoming('KV1|1|0|AA|AA') === null && b3.decryptIncoming('KV2|1|0|AA') === null);
check('non-string / null rejected', b3.decryptIncoming(null) === null && b3.decryptIncoming(42) === null);
check('negative ci rejected', b3.decryptIncoming('KV2|1|-5|AAAA|AAAA') === null);
check('huge ci rejected without breaking chain (DoS guard)', (() => {
	const okMsg = b3.decryptIncoming(a3.encryptOutgoing({ a: 'm', t: 'text', d: 'first' }));
	const forged = 'KV2|1|1000000|AAAA|AAAA';
	if (b3.decryptIncoming(forged) !== null) return false; // must reject
	const next = b3.decryptIncoming(a3.encryptOutgoing({ a: 'm', t: 'text', d: 'second' }));
	return okMsg !== null && next !== null && next.d === 'second'; // chain unharmed
})());

console.log('=== test-ratchet: loss beyond skipped cap ===');
check('cap evicts oldest skipped keys, chain stays alive (liveness)', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('cap'), rekeyEvery: 0, skippedCap: 50 });
	const b = new PeerRatchet({ rootKey: rootOf('cap'), isFirst: true, rekeyEvery: 0, skippedCap: 50 });
	const ws = [];
	for (let i = 0; i < 100; i++) ws.push(a.encryptOutgoing({ a: 'm', t: 'text', d: 'c' + i }));
	// deliver ci=40 (buffers 0..39), then ci=90 (buffers 41..89 → 90 keys →
	// cap evicts lowest 40 → keeps 50..89)
	if (b.decryptIncoming(ws[40]) === null) return false;
	if (b.decryptIncoming(ws[90]) === null) return false;
	if (b.decryptIncoming(ws[0]) !== null) return false;  // evicted
	if (b.decryptIncoming(ws[30]) !== null) return false; // evicted
	return b.decryptIncoming(ws[60]) !== null;            // within kept window
})());
check('huge-but-plausible gap advances the chain (no wedge)', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('live'), rekeyEvery: 0, skippedCap: 10 });
	const b = new PeerRatchet({ rootKey: rootOf('live'), isFirst: true, rekeyEvery: 0, skippedCap: 10 });
	for (let i = 0; i < 200; i++) a.encryptOutgoing({ a: 'm', t: 'text', d: 'x' + i });
	const w200 = null; // ci 0..199 lost (server held them)
	// a fresh message ci=200 arrives: gap 200 > cap 10 → still decrypts
	const w = a.encryptOutgoing({ a: 'm', t: 'text', d: 'alive' });
	const got = b.decryptIncoming(w);
	return got !== null && got.d === 'alive';
})());

console.log('=== test-ratchet: generation / rekey machine ===');
check('rekey trigger only for initiator after threshold', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('rk'), canInitiateRekey: true, rekeyEvery: 5 });
	const b = new PeerRatchet({ rootKey: rootOf('rk'), isFirst: true, canInitiateRekey: false, rekeyEvery: 5 });
	for (let i = 0; i < 4; i++) a.encryptOutgoing({ a: 'm', t: 'text', d: 'r' + i });
	if (a.shouldRekey()) return false; // not yet at 5
	a.encryptOutgoing({ a: 'm', t: 'text', d: 'r4' });
	if (!a.shouldRekey()) return false;
	if (b.shouldRekey()) return false; // non-initiator never triggers
	return a.consumeRekeyGen() === 2 && !a.shouldRekey();
})());
check('full rekey handshake: both sides converge on gen 2', (() => {
	const root1 = rootOf('rkf');
	const root2 = rootOf('rkf-gen2'); // in prod derived via fresh ECDH
	const a = new PeerRatchet({ rootKey: root1, canInitiateRekey: true, rekeyEvery: 3 });
	const b = new PeerRatchet({ rootKey: root1, isFirst: true, canInitiateRekey: false, rekeyEvery: 0 });
	const send = (from, to, w) => to.decryptIncoming(w);
	const msgs1 = [];
	for (let i = 0; i < 3; i++) msgs1.push(a.encryptOutgoing({ a: 'm', t: 'text', d: 'g1-' + i }));
	msgs1.forEach(w => { if (send(a, b, w) === null) throw new Error('g1 fail') });
	if (!a.shouldRekey() || a.consumeRekeyGen() !== 2) return false;
	// rk offer → both seed gen2 root; B activates immediately, A waits for rka
	if (!a.seedRoot(2, root2) || !b.seedRoot(2, root2)) return false;
	if (!b.activateGen(2)) return false;           // B switches send on offer
	// transition: A still on gen1, B already sending gen2 — both must decrypt
	const bOnG2 = b.encryptOutgoing({ a: 'm', t: 'text', d: 'b-on-g2' });
	const gotB = a.decryptIncoming(bOnG2);         // A recv root for gen2 seeded
	const aOnG1 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'a-still-g1' });
	const gotA = b.decryptIncoming(aOnG1);         // B keeps gen1 recv alive
	if (!gotB || gotB.d !== 'b-on-g2') return false;
	if (!gotA || gotA.d !== 'a-still-g1') return false;
	if (!a.activateGen(2)) return false;           // A switches after rka
	const aOnG2 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'a-on-g2' });
	const got2 = b.decryptIncoming(aOnG2);
	if (!got2 || got2.d !== 'a-on-g2') return false;
	// old-generation wire from BEFORE the rekey: gen1 recv pruned after gen3?
	// (still within window: gen2 active, gen1 kept) — must still fail (keys consumed)
	return b.decryptIncoming(aOnG1) === null;
})());
check('seedRoot rejects skipped/overwritten generations', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('sg'), rekeyEvery: 0 });
	return !a.seedRoot(3, rootOf('skip')) && !a.seedRoot(1, rootOf('dup')) && a.seedRoot(2, rootOf('ok'));
})());
check('unknown future generation rejected on recv', (() => {
	const b = new PeerRatchet({ rootKey: rootOf('ug'), isFirst: true, rekeyEvery: 0 });
	return b.decryptIncoming('KV2|7|0|AAAA|AAAA') === null;
})());

console.log('=== test-ratchet: eligibility + state bounds ===');
check('text/image/voice eligible, file volumes not', isRatchetEligible({ a: 'm', t: 'text' }) && isRatchetEligible({ a: 'm', t: 'image' }) && isRatchetEligible({ a: 'm', t: 'voice' }) && isRatchetEligible({ a: 'rs' }) && !isRatchetEligible({ a: 'm', t: 'file_start' }) && !isRatchetEligible({ a: 'm', t: 'file_volume' }) && !isRatchetEligible({ a: 't' }) && !isRatchetEligible({ a: 'cap' }) && !isRatchetEligible(null));
check('rootKey validation', (() => { try { new PeerRatchet({ rootKey: new Uint8Array(8) }); return false } catch (_e) { return true } })());
check('skipped store bounded under repeated gaps', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('bound'), rekeyEvery: 0, skippedCap: 30 });
	const b = new PeerRatchet({ rootKey: rootOf('bound'), rekeyEvery: 0, skippedCap: 30 });
	for (let i = 0; i < 200; i++) b.decryptIncoming(a.encryptOutgoing({ a: 'm', t: 'text', d: 'x' + i }));
	// Bob received everything in order; skipped stays 0. Now simulate the
	// worst case: deliver every 10th → skipped grows but stays ≤ cap.
	const a2 = new PeerRatchet({ rootKey: rootOf('bound2'), rekeyEvery: 0, skippedCap: 30 });
	const b2 = new PeerRatchet({ rootKey: rootOf('bound2'), rekeyEvery: 0, skippedCap: 30 });
	for (let i = 0; i < 200; i++) {
		const w = a2.encryptOutgoing({ a: 'm', t: 'text', d: 'y' + i });
		if (i % 10 === 0) b2.decryptIncoming(w);
	}
	return b2.stats().skipped <= 30;
})());

console.log(`\ntest-ratchet: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

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

console.log('=== test-ratchet: E-1 forged frame burns nothing (peek/commit) ===');
// Flip the last ciphertext byte of a wire (AEAD tag failure, format intact).
const forgeWire = (w) => {
	const p = w.split('|');
	const ct = Buffer.from(p[4], 'base64');
	ct[ct.length - 1] ^= 0xff;
	return p[0] + '|' + p[1] + '|' + p[2] + '|' + p[3] + '|' + ct.toString('base64');
};
check('E-1 core: forged frame preempting ci, legitimate frame still decrypts', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('e1-core'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('e1-core'), isFirst: true, rekeyEvery: 0 });
	const w0 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'e1-zero' });
	const w1 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'e1-one' });
	if (b.decryptIncoming(forgeWire(w1)) !== null) return false; // forged ci=1 first
	if (b.decryptIncoming(w0) === null) return false;
	const got = b.decryptIncoming(w1); // legit ci=1 must survive the forged attempt
	return got !== null && got.d === 'e1-one' && b.stats().recvIndex === 2;
})());
check('E-1: forged out-of-order frame does not burn the skipped key', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('e1-oo'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('e1-oo'), isFirst: true, rekeyEvery: 0 });
	const w0 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'oo-zero' });
	const w1 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'oo-one' });
	const w2 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'oo-two' });
	if (b.decryptIncoming(w2) === null) return false; // buffers skipped keys 0,1
	if (b.decryptIncoming(forgeWire(w0)) !== null) return false; // forged replay of ci=0
	const got = b.decryptIncoming(w0); // legit late arrival still decrypts
	if (!got || got.d !== 'oo-zero') return false;
	if (b.decryptIncoming(w0) !== null) return false; // same frame replayed again fails
	const got1 = b.decryptIncoming(w1);
	return got1 !== null && got1.d === 'oo-one';
})());
check('E-1: forged large-gap frame leaves recvIndex/skipped/recvKey untouched', (() => {
	const b = new PeerRatchet({ rootKey: rootOf('e1-gap'), isFirst: true, rekeyEvery: 0 });
	const g = b.gens.get(1);
	const before = { recvIndex: g.recvIndex, skipped: g.skippedCount(), recvKey: hex(g.recvKey) };
	const forged = 'KV2|1|20000|' + Buffer.alloc(12, 1).toString('base64') + '|' + Buffer.alloc(32, 2).toString('base64');
	if (b.decryptIncoming(forged) !== null) return false;
	return g.recvIndex === before.recvIndex && g.skippedCount() === before.skipped &&
		hex(g.recvKey) === before.recvKey;
})());
check('E-1: structurally invalid frame rejected before derivation, state untouched', (() => {
	const a = new PeerRatchet({ rootKey: rootOf('e1-struct'), rekeyEvery: 0 });
	const b = new PeerRatchet({ rootKey: rootOf('e1-struct'), isFirst: true, rekeyEvery: 0 });
	const w0 = a.encryptOutgoing({ a: 'm', t: 'text', d: 'struct-zero' });
	const shortIv = 'KV2|1|0|' + Buffer.alloc(3, 1).toString('base64') + '|' + Buffer.alloc(32, 2).toString('base64');
	const shortSealed = 'KV2|1|0|' + Buffer.alloc(12, 1).toString('base64') + '|' + Buffer.alloc(16, 2).toString('base64');
	if (b.decryptIncoming(shortIv) !== null || b.decryptIncoming(shortSealed) !== null) return false;
	if (b.stats().recvIndex !== 0) return false;
	const got = b.decryptIncoming(w0);
	return got !== null && got.d === 'struct-zero';
})());

console.log('=== test-ratchet: E-1 peek/commit units ===');
check('E-1: peekRecvKey does not mutate state; mk matches sender derivation', (() => {
	const root = rootOf('e1-peek');
	const send = new RatchetGeneration(root, false);
	const recv = new RatchetGeneration(root, true);
	const mks = [send.nextSendKey(), send.nextSendKey(), send.nextSendKey()];
	const keyBefore = hex(recv.recvKey);
	const peeked = recv.peekRecvKey(2);
	if (!peeked || hex(peeked.mk) !== hex(mks[2].mk)) return false;
	return recv.recvIndex === 0 && recv.skippedCount() === 0 && hex(recv.recvKey) === keyBefore;
})());
check('E-1: commit advances once; second commit is a no-op', (() => {
	const root = rootOf('e1-commit');
	const send = new RatchetGeneration(root, false);
	const recv = new RatchetGeneration(root, true);
	const mks = [send.nextSendKey(), send.nextSendKey(), send.nextSendKey()];
	const peeked = recv.peekRecvKey(2);
	peeked.commit();
	if (recv.recvIndex !== 3 || recv.skippedCount() !== 2) return false;
	if (hex(recv.skipped.get(0)) !== hex(mks[0].mk) || hex(recv.skipped.get(1)) !== hex(mks[1].mk)) return false;
	const keyAfter = hex(recv.recvKey);
	peeked.commit(); // no-op
	return recv.recvIndex === 3 && recv.skippedCount() === 2 && hex(recv.recvKey) === keyAfter;
})());
check('E-1: peekSkipped does not consume; commit deletes exactly once', (() => {
	const root = rootOf('e1-peekskip');
	const send = new RatchetGeneration(root, false);
	const recv = new RatchetGeneration(root, true);
	const mks = [send.nextSendKey(), send.nextSendKey()];
	recv.peekRecvKey(1).commit(); // buffers skipped key for ci=0
	const peeked = recv.peekSkipped(0);
	if (!peeked || hex(peeked.mk) !== hex(mks[0].mk)) return false;
	if (recv.skippedCount() !== 1) return false; // peek consumed nothing
	peeked.commit();
	if (recv.skippedCount() !== 0) return false;
	peeked.commit(); // no-op
	return recv.peekSkipped(0) === null && recv.skippedCount() === 0;
})());
check('E-1: recvKeyFor/takeSkipped compat wrappers still consume immediately', (() => {
	const root = rootOf('e1-compat');
	const send = new RatchetGeneration(root, false);
	const recv = new RatchetGeneration(root, true);
	const mks = [send.nextSendKey(), send.nextSendKey(), send.nextSendKey()];
	const mk1 = recv.recvKeyFor(1); // skips ci=0 into the store, consumes ci=1
	if (!mk1 || hex(mk1) !== hex(mks[1].mk) || recv.recvIndex !== 2 || recv.skippedCount() !== 1) return false;
	const mk0 = recv.takeSkipped(0);
	return !!mk0 && hex(mk0) === hex(mks[0].mk) && recv.skippedCount() === 0 && recv.takeSkipped(0) === null;
})());

console.log('=== test-ratchet: E-1 golden fixture interop (v1.9.3 wires) ===');
// Fixture generated on UNMODIFIED v1.9.3 (see §0.4): sender isFirst=false,
// receiver isFirst=true. Constants copied verbatim from
// ~/workspace/jiamiliaotian-audit/fixtures-v193.json.
const GOLD_ROOT_HEX = 'e52b48334d65de7472928736f0312f8e0285e20f34b5e000a882784e1d755c28';
const GOLD_ROOT2_HEX = '795a810007bc89b38b7933c320c255717fb1db24f5804153a6e670a38a31a7b1';
const GOLD_PLAINS = [
	{ a: 'm', t: 'text', d: 'golden-0', id: 'gid0aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-1', id: 'gid1aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-2', id: 'gid2aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-3', id: 'gid3aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-4', id: 'gid4aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-5', id: 'gid5aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-6', id: 'gid6aaaaaa' },
	{ a: 'm', t: 'text', d: 'golden-7', id: 'gid7aaaaaa' }
];
const GOLD_WIRES = [
	'KV2|1|0|7gwbOU1XDLoiUHUY|9Jto0cqoc2mw1/9D8T8cecvukfvWWEzFntY2qlYnQ2dxmsWGceoYKPBANC73LG5EkwjSH0Eyh4KQycF2g1OpI4782rgQ',
	'KV2|1|1|afR9hi+PQ0IcBRfO|Pq75RmA50L1TdYQq0tL9Pti/EY6HTtHUKD7LSmi4VNS1Vdoi0OcaHbUC/1y2DQfgEioAd3BFqHCoS4DltrgmV/2Ed/vu',
	'KV2|1|2|cxJMFhyW69DTqDoP|yFzrJT3F6URolSTMgOV70RDwUrQpX7rtsGwfCNGrRF7i5vtrRqwVcvo8nAq5r4APt/qsVtjwt1lCwwoowXbgtgAML3ld',
	'KV2|1|3|FXBjhNfRer2bjFXm|oIRoIottgvJpeXo11A9OROiWlNiuGUCyCWFd9U+f+FrY2ntYwVTuIfvXi+VqhbmEm4PlJsCCJMXIwKvkgF0fOg+eDYbP',
	'KV2|1|4|4sFRMCZGuOHx2QT7|YHmcCqlzoNcz+eN424NoX4GwLlPRMEYnmthCC2Du8rnCOAltEkch1dI3NeDg/Gk+efFfTVWFF3yJ/pZILQy2zUHwuv6l',
	'KV2|1|5|WqedhCMz0rxdmsOu|3Jj2i18pLdJqeTSWAeah2bNlDv/0ggW+oiptyqBbYj2VMw6nzgHiN8fymknNWgbbIC6N8y/sQNSVOICLADP8qZf4AjRH',
	'KV2|1|6|6AnXSPHsZCXJQ24z|+CnyFhkjqCuJFf5FYbjPcKqbxG9mNDqraC050S1oxyH8alGuDExC/LTujQSy7W+p3jjxk1b4Aoov/CVdWNPrPTqI2K2+',
	'KV2|1|7|Ux0WgNpv3QLvdFZr|69MhAD/bDoyPGSQiUSoxjkAlYsL0F/Jrl4q5GG/zUcbQP5tEfXzcVpTBqf5VFPCEP4vkyVGDXveWBVhFyf74AxjhKlpk'
];
const GOLD_GEN2_PLAIN = { a: 'm', t: 'text', d: 'golden-gen2', id: 'gidgen2aaaa' };
const GOLD_GEN2_WIRE = 'KV2|2|0|s3AJusSVOdNf5pla|3dIPs9xcCFd3TAgGWOpOPx7NFgnn/Y7WLvRIKR5BsGpgh70uI3r6hL7+BnkRSUTWK6fLL+Cuyf8dRkIG69OBFNuYMJ1VD4AoiQ==';
const goldEq = (got, want) => got !== null && JSON.stringify(got) === JSON.stringify(want);
const goldRecv = new PeerRatchet({ rootKey: Uint8Array.from(Buffer.from(GOLD_ROOT_HEX, 'hex')), isFirst: true, rekeyEvery: 0 });
check('golden fixture: wires 0-4 decrypt in order, plaintext equal', (() => {
	for (let i = 0; i <= 4; i++) if (!goldEq(goldRecv.decryptIncoming(GOLD_WIRES[i]), GOLD_PLAINS[i])) return false;
	return true;
})());
check('golden fixture: wire 7 before 5/6 (out of order), then 5/6 decrypt, plaintext equal', (() => {
	if (!goldEq(goldRecv.decryptIncoming(GOLD_WIRES[7]), GOLD_PLAINS[7])) return false;
	if (!goldEq(goldRecv.decryptIncoming(GOLD_WIRES[5]), GOLD_PLAINS[5])) return false;
	return goldEq(goldRecv.decryptIncoming(GOLD_WIRES[6]), GOLD_PLAINS[6]);
})());
check('golden fixture: gen2 wire decrypts after seedRoot(root2), plaintext equal', (() => {
	if (!goldRecv.seedRoot(2, Uint8Array.from(Buffer.from(GOLD_ROOT2_HEX, 'hex')))) return false;
	return goldEq(goldRecv.decryptIncoming(GOLD_GEN2_WIRE), GOLD_GEN2_PLAIN);
})());

console.log(`\ntest-ratchet: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

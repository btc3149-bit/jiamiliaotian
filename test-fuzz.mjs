// Item 40: lightweight randomized parser tests (zero dependencies, no
// fuzzing framework). Fixed-seed PRNG => fully deterministic, CI-safe.
// Short version (fixed iteration counts) runs in the default test chain;
// set FUZZ_ITERS to scale up for a manual long run.
//
// Properties asserted:
//  1. Malformed KV2 / legacy frames never throw out of decryptIncoming and
//     never mutate ratchet state (E-1 style per-value snapshot comparison:
//     recvIndex / skipped count / recv chain key, generation by generation).
//     NOTE: frames that PASS AEAD but carry corrupt JSON legitimately commit
//     their index (see util.ratchet.js), so the generator only produces
//     frames that fail structure or AEAD — mutations keep the tag invalid.
//  2. Random Markdown-ish input never throws and never renders dangerous
//     HTML (no live tags, no event-handler attributes, no javascript:/data:
//     links).
// Run: node test-fuzz.mjs   (long run: FUZZ_ITERS=20000 node test-fuzz.mjs)
import { PeerRatchet, hmacSha256 } from './client/js/util.ratchet.js';
import { markdownToHtml } from './client/js/util.markdown.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

// mulberry32: tiny deterministic PRNG.
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = rng(0xC0FFEE);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randBytes = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rand() * 256); return b; };
const hex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');
const rootOf = (seed) => hmacSha256(new TextEncoder().encode('seed:' + seed), new TextEncoder().encode('jmlt-fuzz'));

const ITERS = Number(process.env.FUZZ_ITERS || 600);

function snapshot(ratchet) {
	const out = [];
	for (const [gen, g] of ratchet.gens) {
		out.push([gen, g.recvIndex, g.skippedCount(), hex(g.recvKey), g.sendIndex, hex(g.sendKey)]);
	}
	return JSON.stringify(out);
}

console.log('=== test-fuzz: malformed KV2/legacy frames vs ratchet state ===');
{
	const alice = new PeerRatchet({ rootKey: rootOf('fuzz'), rekeyEvery: 0 });
	const bob = new PeerRatchet({ rootKey: rootOf('fuzz'), isFirst: true, rekeyEvery: 0 });
	const legit = [];
	for (let i = 0; i < 5; i++) legit.push(alice.encryptOutgoing({ a: 'm', t: 'text', d: 'fuzz-' + i }));
	// Consume two legitimately so state is non-trivial (recvIndex=2).
	bob.decryptIncoming(legit[0]); bob.decryptIncoming(legit[1]);

	const malformed = () => {
		const kind = Math.floor(rand() * 6);
		const lp = legit[Math.floor(rand() * legit.length)].split('|');
		if (kind === 0) { // random KV2-shaped frame, random payload (AEAD will fail)
			// ci stays within a few hundred of the consumed range: huge gaps
			// make peekRecvKey derive key-by-key (bounded by RATCHET_MAX_GAP)
			// and would slow the short CI version without testing more.
			return `KV2|${1 + Math.floor(rand() * 3)}|${Math.floor(rand() * 260)}|${randBytes(12).toString('base64')}|${randBytes(17 + Math.floor(rand() * 64)).toString('base64')}`;
		}
		if (kind === 1) { // mutate a legit frame: flip a ciphertext byte (tag fails)
			const ct = Buffer.from(lp[4], 'base64'); ct[Math.floor(rand() * ct.length)] ^= 0xff;
			return [lp[0], lp[1], lp[2], lp[3], ct.toString('base64')].join('|');
		}
		if (kind === 2) { // truncate / extend / drop a field
			const parts = [...lp];
			const op = Math.floor(rand() * 3);
			if (op === 0) parts.splice(Math.floor(rand() * parts.length), 1);
			else if (op === 1) parts.push(randBytes(4).toString('base64'));
			else parts[2] = String(Number(parts[2]) + 300 + Math.floor(rand() * 300));
			return parts.join('|');
		}
		if (kind === 3) { // legacy-shaped / free-form garbage
			return pick(['', 'ping', 'KV1|1|0|AAAA|BBBB', 'KV2|', '||||', 'KV2|x|y|z|w',
				randBytes(32).toString('hex'), JSON.stringify({ a: 'm', d: 'x' }), 'KV2|1|-1|AAAA|BBBB',
				'KV2|0|0|' + randBytes(12).toString('base64') + '|' + randBytes(32).toString('base64')]);
		}
		if (kind === 4) { // wrong IV / sealed lengths
			return `KV2|1|${Math.floor(rand() * 10)}|${randBytes(Math.floor(rand() * 20)).toString('base64')}|${randBytes(Math.floor(rand() * 20)).toString('base64')}`;
		}
		// kind 5: replay an already-consumed legit frame (must fail, no state change)
		return legit[Math.floor(rand() * 2)];
	};

	let threw = 0; let accepted = 0; let stateChanged = 0;
	for (let i = 0; i < ITERS; i++) {
		const before = snapshot(bob);
		let out;
		try { out = bob.decryptIncoming(malformed()); } catch (_e) { threw++; continue; }
		if (out !== null) accepted++;
		if (snapshot(bob) !== before) stateChanged++;
	}
	check(`no uncaught exceptions over ${ITERS} malformed frames`, threw === 0);
	check('no malformed frame was accepted', accepted === 0);
	check('ratchet state byte-identical after every malformed frame', stateChanged === 0);
	const got = bob.decryptIncoming(legit[2]);
	check('next legit frame still decrypts after the fuzz barrage', got !== null && got.d === 'fuzz-2');
}

console.log('=== test-fuzz: randomized markdown rendering safety ===');
{
	const atoms = ['<script>', '</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)',
		'https://example.com/', '**', '*', '`', '```', '[x](javascript:1)', '"', "'", '<', '>',
		'&', 'onerror=', 'data:text/html;base64,xx', 'plain', '文字', '\n', ' ', '<a href="', ')>', 'svg onload='];
	let threw = 0; let dangerous = 0;
	for (let i = 0; i < ITERS; i++) {
		const n = 1 + Math.floor(rand() * 8);
		let input = '';
		for (let j = 0; j < n; j++) input += pick(atoms);
		let html;
		try { html = markdownToHtml(input); } catch (_e) { threw++; continue; }
		if (/<(script|img|iframe|svg|body|input)\b/i.test(html)
			|| /<[a-z][^>]*\son\w+\s*=/i.test(html)
			|| /href="(javascript|data|vbscript):/i.test(html)) dangerous++;
	}
	check(`markdown never throws over ${ITERS} random inputs`, threw === 0);
	check('markdown never emits dangerous HTML', dangerous === 0);
	// Non-string inputs must not throw either.
	let nsThrew = false;
	for (const v of [null, undefined, 42, {}, [], true]) { try { markdownToHtml(v); } catch (_e) { nsThrew = true; } }
	check('markdown tolerates non-string inputs', !nsThrew);
}

console.log(`\ntest-fuzz: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

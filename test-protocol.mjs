// Protocol-layer tests (review R5). Covers the pure validation helpers in
// client/js/util.validate.js — the single trust boundary for the sync/replay
// protocol and read receipts. Run: node test-protocol.mjs
// 协议层测试（评审 R5）。覆盖 sync/rs 协议与已读回执的唯一信任边界实现。
import {
	isValidMid,
	sanitizeReplayEntry,
	dedupeReplayBatch,
	selectReplayable,
	filterValidMids
} from './client/js/util.validate.js';

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

console.log('=== test-protocol: message id whitelist ===');
check('accepts 8-char alnum', isValidMid('abcdefgh'));
check('accepts 32-char alnum', isValidMid('a'.repeat(32)));
check('rejects 7 chars', !isValidMid('abcdefg'));
check('rejects 33 chars', !isValidMid('a'.repeat(33)));
check('rejects special chars', !isValidMid('abcd<efg>'));
check('rejects non-string', !isValidMid(12345) && !isValidMid(null) && !isValidMid(undefined));

console.log('=== test-protocol: sanitizeReplayEntry ===');
const good = {
	id: 'msg12345678', t: 'text', d: 'hello world', ts: Date.now() - 5000,
	u: 'alice', self: false, m: ['peer123456'], q: { u: 'bob', x: 'quoted' }, ttl: 300
};
const s1 = sanitizeReplayEntry(good);
check('valid entry passes', !!s1 && s1.id === good.id && s1.t === 'text' && s1.d === 'hello world');
check('ts preserved', s1.ts === good.ts);
check('ttl whitelist kept', s1.ttl === 300);
check('mentions kept', Array.isArray(s1.m) && s1.m.length === 1);

check('rejects null', sanitizeReplayEntry(null) === null);
check('rejects non-object', sanitizeReplayEntry('x') === null);
check('rejects bad id', sanitizeReplayEntry({ ...good, id: 'BAD ID!' }) === null);
check('rejects unknown type', sanitizeReplayEntry({ ...good, t: 'file_start' }) === null);
check('rejects empty text', sanitizeReplayEntry({ ...good, d: '' }) === null);
check('rejects oversize text', sanitizeReplayEntry({ ...good, d: 'x'.repeat(10001) }) === null);
check('accepts 10k text boundary', !!sanitizeReplayEntry({ ...good, d: 'x'.repeat(10000) }));
check('rejects oversize image', sanitizeReplayEntry({ ...good, t: 'image', d: 'x'.repeat(300001) }) === null);
check('accepts 300k image boundary', !!sanitizeReplayEntry({ ...good, t: 'image', d: 'x'.repeat(300000) }));
check('rejects non-whitelisted ttl', sanitizeReplayEntry({ ...good, ttl: 60 }).ttl === null);
check('rejects future ts beyond skew', sanitizeReplayEntry({ ...good, ts: Date.now() + 600000 }).ts === 0);
check('truncates long username', sanitizeReplayEntry({ ...good, u: 'u'.repeat(100) }).u.length === 64);
check('filters invalid mentions', sanitizeReplayEntry({ ...good, m: ['ok123456', 'bad!', 42] }).m.length === 1);
check('drops oversize quote', sanitizeReplayEntry({ ...good, q: { u: 'b', x: 'x'.repeat(301) } }).q === null);
check('keeps valid quote', sanitizeReplayEntry({ ...good, q: { u: 'b', x: 'x'.repeat(300) } }).q.x.length === 300);

console.log('=== test-protocol: dedupeReplayBatch ===');
const e1 = { id: 'aaaa1111', t: 'text', d: 'one', ts: 1000, u: '', self: false, m: [], q: null, ttl: null };
const e2 = { id: 'bbbb2222', t: 'text', d: 'two', ts: 2000, u: '', self: false, m: [], q: null, ttl: null };
const e3dup = { id: 'aaaa1111', t: 'text', d: 'dupe', ts: 3000, u: '', self: false, m: [], q: null, ttl: null };
const e4bad = { id: 'bad id!!!', t: 'text', d: 'nope', ts: 4000, u: '', self: false, m: [], q: null, ttl: null };

const batch1 = dedupeReplayBatch([e1, e2, e3dup, e4bad], new Set());
check('keeps unique valid, drops dup + invalid', batch1.length === 2 && batch1[0].id === 'aaaa1111' && batch1[1].id === 'bbbb2222');
const batch2 = dedupeReplayBatch([e1, e2], new Set(['aaaa1111']));
check('respects pre-existing ids', batch2.length === 1 && batch2[0].id === 'bbbb2222');
const many = Array.from({ length: 60 }, (_, i) => ({ id: `id${String(i).padStart(8, '0')}`, t: 'text', d: 'm', ts: i, u: '', self: false, m: [], q: null, ttl: null }));
check('caps batch at 50', dedupeReplayBatch(many, new Set()).length === 50);
check('handles non-array input', dedupeReplayBatch(null, new Set()).length === 0);
check('non-Set existing treated as empty set (defensive)', dedupeReplayBatch([e1], ['aaaa1111']).length === 1);

console.log('=== test-protocol: selectReplayable (watermark + filters) ===');
const NOW = Date.now();
const buf = [
	{ type: 'system', text: 'sys', timestamp: NOW - 100, id: 'sysmsg001' },
	{ type: 'other', text: 'old', userName: 'bob', msgType: 'text', timestamp: NOW - 90000, id: 'oldmsg0001' },   // before watermark
	{ type: 'other', text: 'new1', userName: 'bob', msgType: 'text', timestamp: NOW - 5000, id: 'newmsg00001' },  // replayable
	{ type: 'me', text: 'new2', msgType: 'text', timestamp: NOW - 4000, id: 'mymmsg0001' },                        // own, replayable
	{ type: 'other', text: 'gone', userName: 'bob', msgType: 'text', timestamp: NOW - 3000, id: 'burnedmsg01', burned: true },  // burned
	{ type: 'other', text: 'gone2', userName: 'bob', msgType: 'text', timestamp: NOW - 2000, id: 'recalledm1', deleted: true }, // recalled
	{ type: 'other', text: 'data', userName: 'bob', msgType: 'file_start', timestamp: NOW - 1000, id: 'filexfer001' },          // file: skip
	{ type: 'other', text: 'known', userName: 'bob', msgType: 'text', timestamp: NOW - 500, id: 'knownmsg01' }                  // known id
];
const sel = selectReplayable(buf, NOW - 60000, new Set(['knownmsg01']), 'me-user');
check('selects exactly the 2 replayable entries', sel.length === 2);
check('entries are new1 + new2 in order', sel[0].id === 'newmsg00001' && sel[1].id === 'mymmsg0001');
check('own message marked self with my username', sel[1].self === true && sel[1].u === 'me-user');
check('other message keeps author name', sel[0].self === false && sel[0].u === 'bob');
check('watermark respected (old excluded)', !sel.some(e => e.id === 'oldmsg0001'));
check('burned excluded', !sel.some(e => e.id === 'burnedmsg01'));
check('recalled excluded', !sel.some(e => e.id === 'recalledm1'));
check('file transfer excluded', !sel.some(e => e.id === 'filexfer001'));
check('known id excluded', !sel.some(e => e.id === 'knownmsg01'));
check('system entries excluded', !sel.some(e => e.id === 'sysmsg001'));

// burn-after-ttl entry survives selection with ttl intact
const withTtl = selectReplayable(
	[{ type: 'other', text: 'boom', userName: 'bob', msgType: 'text', timestamp: NOW - 100, id: 'ttlmsg0001', ttl: 30 }],
	0, new Set(), '');
check('ttl carried through selection', withTtl.length === 1 && withTtl[0].ttl === 30);

console.log('=== test-protocol: read-receipt whitelist ===');
check('filters valid ids only', JSON.stringify(filterValidMids(['ok123456', 'bad', 'ok654321', null, 7])) === JSON.stringify(['ok123456', 'ok654321']));
check('caps at 50', filterValidMids(Array.from({ length: 80 }, (_, i) => `mid${String(i).padStart(8, '0')}`)).length === 50);
check('non-array input', filterValidMids('x').length === 0);

console.log(`\ntest-protocol: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

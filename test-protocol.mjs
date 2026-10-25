// Protocol-layer tests (review R5). Covers the pure validation helpers in
// client/js/util.validate.js — the single trust boundary for the sync/replay
// protocol and read receipts. Run: node test-protocol.mjs
// 协议层测试（评审 R5）。覆盖 sync/rs 协议与已读回执的唯一信任边界实现。
import {
	isValidMid,
	sanitizeReplayEntry,
	dedupeReplayBatch,
	selectReplayable,
	filterValidMids,
	sanitizeResumeRequest,
	isValidFileVolumeMessage,
	sanitizePresenceStatus,
	sanitizeCallSignal,
	parseStunServers,
	sanitizeBakedServerUrl
} from './client/js/util.validate.js';
import {
	formatVoiceDuration,
	isVoiceMsgType,
	sanitizeVoicePayload
} from './client/js/util.voice.js';
import {
	mergeFlushResults
} from './client/js/util.sendQueue.js';

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

console.log('=== test-protocol: v1.2.0 file resume ===');
const rr = sanitizeResumeRequest('FileId_123', [5, 2, 5, 0], 10);
check('valid request passes with deduped sorted indices', !!rr && rr.fileId === 'FileId_123' && JSON.stringify(rr.missing) === JSON.stringify([0, 2, 5]));
check('rejects bad fileId', sanitizeResumeRequest('bad id!', [0], 10) === null);
check('rejects out-of-range index', sanitizeResumeRequest('FileId_123', [10], 10) === null);
check('rejects negative index', sanitizeResumeRequest('FileId_123', [-1], 10) === null);
check('rejects empty missing', sanitizeResumeRequest('FileId_123', [], 10) === null);
check('rejects non-array missing', sanitizeResumeRequest('FileId_123', '0', 10) === null);
check('rejects bad totalVolumes', sanitizeResumeRequest('FileId_123', [0], 0) === null && sanitizeResumeRequest('FileId_123', [0], 'x') === null);
check('rejects over-cap request', sanitizeResumeRequest('FileId_123', Array.from({ length: 600 }, (_, i) => i), 1000) === null);
check('accepts exactly at cap', (() => { const r = sanitizeResumeRequest('FileId_123', Array.from({ length: 512 }, (_, i) => i), 1000); return !!r && r.missing.length === 512; })());
check('volume message whitelist accepts well-formed', isValidFileVolumeMessage({ fileId: 'FileId_123', volumeIndex: 3, volumeData: 'aGVsbG8=' }));
check('volume message whitelist rejects junk', !isValidFileVolumeMessage({ fileId: 'x', volumeIndex: -1, volumeData: '' }) && !isValidFileVolumeMessage(null) && !isValidFileVolumeMessage({ fileId: 'FileId_123', volumeIndex: 1.5, volumeData: 'aa' }));

console.log('=== test-protocol: v1.2.0 voice helpers ===');
check('duration formats m:ss', formatVoiceDuration(0) === '0:00' && formatVoiceDuration(65000) === '1:05' && formatVoiceDuration(595000) === '9:55');
check('negative/NaN clamps to 0:00', formatVoiceDuration(-5) === '0:00' && formatVoiceDuration(NaN) === '0:00');
check('voice type detection', isVoiceMsgType('voice') && isVoiceMsgType('voice_private') && !isVoiceMsgType('text'));
check('voice payload accepts audio dataURL', !!sanitizeVoicePayload({ audio: 'data:audio/webm;base64,SGVsbG8=', dur: 7 }));
check('voice payload rejects non-audio scheme', sanitizeVoicePayload({ audio: 'data:text/html;base64,PGI+', dur: 7 }) === null);
check('voice payload rejects javascript: scheme', sanitizeVoicePayload({ audio: 'javascript:alert(1)', dur: 7 }) === null);
check('voice payload rejects oversized', sanitizeVoicePayload({ audio: 'data:audio/webm;base64,' + 'A'.repeat(3 * 1024 * 1024), dur: 7 }) === null);
check('voice payload clamps bad duration', sanitizeVoicePayload({ audio: 'data:audio/webm;base64,SGVsbG8=', dur: 'x' }).dur === 0 && sanitizeVoicePayload({ audio: 'data:audio/webm;base64,SGVsbG8=', dur: 9999 }).dur === 120);
check('voice payload rejects non-object', sanitizeVoicePayload('x') === null && sanitizeVoicePayload(null) === null);

console.log('=== test-protocol: v1.2.0 send queue ===');
check('failed items re-queue in front preserving order', JSON.stringify(mergeFlushResults(['q1', 'q2'], ['f1', 'f2'])) === JSON.stringify(['f1', 'f2', 'q1', 'q2']));
check('empty failures leave queue untouched', JSON.stringify(mergeFlushResults(['q1'], [])) === JSON.stringify(['q1']));

console.log('=== test-protocol: v1.4.0 presence whitelist ===');
check('accepts the three declared states', sanitizePresenceStatus('online') === 'online' && sanitizePresenceStatus('away') === 'away' && sanitizePresenceStatus('busy') === 'busy');
check('rejects arbitrary strings', sanitizePresenceStatus('online ') === null && sanitizePresenceStatus('ONLINE') === null && sanitizePresenceStatus('idle') === null);
check('rejects injection vectors', sanitizePresenceStatus('<script>') === null && sanitizePresenceStatus('online;alert(1)') === null);
check('rejects non-strings', sanitizePresenceStatus(null) === null && sanitizePresenceStatus(undefined) === null && sanitizePresenceStatus(42) === null && sanitizePresenceStatus({}) === null && sanitizePresenceStatus(['online']) === null);

console.log('=== test-protocol: v1.5.0 call signal sanitizer ===');
const sdp = 'v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
check('valid offer passes with sdp', sanitizeCallSignal({ t: 'offer', sdp }).sdp === sdp);
check('valid answer passes', sanitizeCallSignal({ t: 'answer', sdp }).t === 'answer');
check('valid candidate passes with mid', (() => { const c = sanitizeCallSignal({ t: 'candidate', candidate: 'candidate:1 1 UDP 2122260223 192.168.1.4 56789 typ host', mid: '0' }); return !!c && c.mid === '0' && c.candidate.startsWith('candidate:1'); })());
check('hangup/decline need no payload', !!sanitizeCallSignal({ t: 'hangup' }) && !!sanitizeCallSignal({ t: 'decline' }));
check('rejects unknown types', sanitizeCallSignal({ t: 'invite', sdp }) === null && sanitizeCallSignal({ t: 'OFFER', sdp }) === null && sanitizeCallSignal({ t: '' }) === null);
check('rejects null/non-object', sanitizeCallSignal(null) === null && sanitizeCallSignal('offer') === null && sanitizeCallSignal(42) === null);
check('rejects missing/empty sdp', sanitizeCallSignal({ t: 'offer' }) === null && sanitizeCallSignal({ t: 'offer', sdp: '' }) === null);
check('rejects oversize sdp (32k cap)', sanitizeCallSignal({ t: 'offer', sdp: 'x'.repeat(32769) }) === null);
check('accepts 32k sdp boundary', !!sanitizeCallSignal({ t: 'offer', sdp: 'x'.repeat(32768) }));
check('rejects sdp with control chars', sanitizeCallSignal({ t: 'offer', sdp: 'v=0\r\n\x00evil' }) === null && sanitizeCallSignal({ t: 'offer', sdp: '\u0007bell' }) === null);
check('accepts sdp with newlines (CRLF ok)', !!sanitizeCallSignal({ t: 'offer', sdp: 'a\r\nb\r\n' }));
check('rejects empty/oversize candidate', sanitizeCallSignal({ t: 'candidate', candidate: '' }) === null && sanitizeCallSignal({ t: 'candidate', candidate: 'c'.repeat(2049) }) === null);
check('oversize mid clamps to empty', sanitizeCallSignal({ t: 'candidate', candidate: 'x', mid: 'm'.repeat(200) }).mid === '');
check('non-string candidate rejected', sanitizeCallSignal({ t: 'candidate', candidate: 42 }) === null);

console.log('=== test-protocol: v1.5.0 stun server parser ===');
check('parses single stun url', JSON.stringify(parseStunServers('stun:stun.example.net:3478')) === JSON.stringify(['stun:stun.example.net:3478']));
check('parses host without port', JSON.stringify(parseStunServers('stun:stun.example.net')) === JSON.stringify(['stun:stun.example.net']));
check('parses comma+space separated list', parseStunServers('stun:a.example:1, stun:b.example; stun:c.example').length === 2 && parseStunServers('stun:a.example:1, stun:b.example; stun:c.example')[0] === 'stun:a.example:1');
check('normalizes leading zeros in port', parseStunServers('stun:h.example:0080')[0] === 'stun:h.example:80');
check('rejects turn urls', parseStunServers('turn:turn.example.net:3478').length === 0);
check('rejects bad host charset', parseStunServers('stun:bad_host!.example').length === 0 && parseStunServers('stun:http://evil.example').length === 0);
check('rejects out-of-range ports', parseStunServers('stun:h.example:0').length === 0 && parseStunServers('stun:h.example:99999').length === 0);
check('dedupes repeated entries', parseStunServers('stun:a.example:1 stun:a.example:1').length === 1);
check('caps at 4 servers', parseStunServers('stun:a:1 stun:b:1 stun:c:1 stun:d:1 stun:e:1').length === 4);
check('non-string / empty input', JSON.stringify(parseStunServers(null)) === '[]' && JSON.stringify(parseStunServers('')) === '[]' && JSON.stringify(parseStunServers(42)) === '[]');

console.log('=== test-protocol: v1.8.0 baked default server sanitizer ===');
check('accepts plain https origin', sanitizeBakedServerUrl('https://nodecrypt.example.workers.dev') === 'https://nodecrypt.example.workers.dev');
check('accepts https with port', sanitizeBakedServerUrl('https://chat.example.com:8443') === 'https://chat.example.com:8443');
check('strips trailing slash (origin form)', sanitizeBakedServerUrl('https://chat.example.com/') === 'https://chat.example.com');
check('trims whitespace', sanitizeBakedServerUrl('  https://chat.example.com  ') === 'https://chat.example.com');
check('rejects http', sanitizeBakedServerUrl('http://chat.example.com') === '');
check('rejects path-bearing urls', sanitizeBakedServerUrl('https://example.com/app') === '');
check('rejects query strings', sanitizeBakedServerUrl('https://example.com/?x=1') === '');
check('rejects hash fragments', sanitizeBakedServerUrl('https://example.com/#room') === '');
check('rejects userinfo / credentials', sanitizeBakedServerUrl('https://user:pass@example.com') === '');
check('rejects garbage / empty / non-string', sanitizeBakedServerUrl('not a url') === '' && sanitizeBakedServerUrl('') === '' && sanitizeBakedServerUrl(null) === '' && sanitizeBakedServerUrl(42) === '');


console.log('=== test-protocol: v1.8.3 CSP inline-handler regression ===');
// The worker serves script-src 'self' (no unsafe-inline): inline onclick
// attribute handlers are silently refused by the browser. Regression guard:
// no client template may emit inline event-handler attributes.
import { readFileSync } from 'node:fs';
const CSP_GUARD_FILES = ['client/js/chat.js', 'client/js/ui.js', 'client/js/util.settings.js', 'client/js/util.file.js', 'client/js/util.fileUpload.js', 'client/js/main.js'];
let cspClean = true;
for (const f of CSP_GUARD_FILES) {
  const src = readFileSync(new URL('./' + f, import.meta.url), 'utf-8');
  const m = src.match(/\son(click|change|submit|load|input|error)=/);
  if (m) { cspClean = false; console.log('  inline handler in', f, ':', m[0]); }
}
check('no inline event-handler attributes in client templates', cspClean);
// download button must be plain button + delegated (data-file-id present)
const chatSrc = readFileSync(new URL('./client/js/chat.js', import.meta.url), 'utf-8');
check('download button has no inline onclick', !chatSrc.includes('onclick='));
check('download button keeps data-file-id for delegation', chatSrc.includes('data-file-id=') && chatSrc.includes('file-download-btn'));
const mainSrc = readFileSync(new URL('./client/js/main.js', import.meta.url), 'utf-8');
check('delegated download listener exists in main.js', mainSrc.includes("closest('.file-download-btn')") && mainSrc.includes('downloadFile(fileId)'));

console.log(`\ntest-protocol: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

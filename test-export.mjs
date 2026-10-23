// v1.3.0 #7: encrypted archive round-trip / wrong-password / tamper tests.
// Node 22: globalThis.crypto.subtle is available.
import {
	collectExportMessages,
	serializeArchive,
	encryptArchive,
	decryptArchive,
	validateArchivePayload,
	parseArchiveContainer,
	mergeArchiveMessages
} from './client/js/util.exportArchive.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name) }
	else { failed++; console.log('  ✗ FAIL: ' + name) }
}

const FP = 'a'.repeat(64);
const PASSWORD = 'correct horse battery staple';

const rd = {
	myUserName: 'me',
	messages: [
		{ type: 'me', text: 'hello **world**', msgType: 'text', timestamp: 1000, id: 'msg00000001' },
		{ type: 'other', text: 'hi there', msgType: 'text', timestamp: 2000, id: 'msg00000002', userName: 'bob' },
		{ type: 'system', text: 'bob joined', timestamp: 1500 },
		{ type: 'other', text: 'burned secret', msgType: 'text', timestamp: 3000, id: 'msg00000003', userName: 'bob', burned: true },
		{ type: 'other', text: 'recalled msg', msgType: 'text', timestamp: 4000, id: 'msg00000004', userName: 'bob', deleted: true },
		{ type: 'other', text: { fileId: 'x' }, msgType: 'file', timestamp: 5000, id: 'msg00000005', userName: 'bob' },
		{ type: 'other', text: { audio: 'data:audio/webm;base64,SGg=', dur: 3 }, msgType: 'voice', timestamp: 6000, id: 'msg00000006', userName: 'bob' }
	]
};

console.log('=== test-export: collect ===');
const { msgs, skipped } = collectExportMessages(rd);
check('burned/recalled excluded', !msgs.some(m => m.id === 'msg00000003' || m.id === 'msg00000004'));
check('file transfer skipped + counted', !msgs.some(m => m.id === 'msg00000005') && skipped === 1);
check('text/image/voice/system kept', msgs.length === 4);
check('voice payload preserved', msgs.some(m => m.id === 'msg00000006' && m.x && m.x.dur === 3));

console.log('=== test-export: round-trip ===');
const json = serializeArchive(FP, msgs, skipped);
const bytes = await encryptArchive(json, PASSWORD, FP);
const container = parseArchiveContainer(bytes);
check('container header parses', !!container && container.fp16 === FP.slice(0, 16));
check('container magic + version', bytes[0] === 0x4A && bytes[1] === 0x4D && bytes[5] === 0x31);
const decrypted = await decryptArchive(bytes, PASSWORD, FP);
check('round-trip restores all messages', decrypted.msgs.length === msgs.length);
check('round-trip preserves text content', decrypted.msgs[0].x === 'hello **world**');
check('archive validates against expected fp', !!validateArchivePayload(JSON.parse(json), FP));

console.log('=== test-export: wrong password / tamper ===');
let wrongRejected = false;
try { await decryptArchive(bytes, 'wrong password', FP) } catch (_e) { wrongRejected = true }
check('wrong password rejected (GCM auth)', wrongRejected);
const tampered = Uint8Array.from(bytes);
tampered[tampered.length - 1] ^= 0xff;
let tamperRejected = false;
try { await decryptArchive(tampered, PASSWORD, FP) } catch (_e) { tamperRejected = true }
check('tampered ciphertext rejected', tamperRejected);
const badHeader = Uint8Array.from(bytes); badHeader[0] = 0x58;
check('bad magic rejected', parseArchiveContainer(badHeader) === null);

console.log('=== test-export: payload validation ===');
check('rejects wrong version', validateArchivePayload({ v: 2, fp: FP, msgs: [] }, FP) === null);
check('rejects bad fp length', validateArchivePayload({ v: 1, fp: 'short', msgs: [] }, FP) === null);
check('rejects non-array msgs', validateArchivePayload({ v: 1, fp: FP, msgs: 'x' }, null) === null);
check('rejects oversize archive', validateArchivePayload({ v: 1, fp: FP, msgs: new Array(50001).fill({ k: 'me', t: 'text', x: 'a', ts: 1 }) }, null) === null);
check('drops entries with hostile msgType', (() => {
	const v = validateArchivePayload({ v: 1, fp: FP, msgs: [{ k: 'me', t: 'text<img>', x: 'a', ts: 1 }] }, null);
	return v.msgs.length === 0
})());
check('caps hostile string lengths', (() => {
	const v = validateArchivePayload({ v: 1, fp: FP, msgs: [{ k: 'me', t: 'text', x: 'x'.repeat(200000), ts: 1 }] }, null);
	return v.msgs.length === 0
})());
check('bad id dropped to null', (() => {
	const v = validateArchivePayload({ v: 1, fp: FP, msgs: [{ k: 'me', t: 'text', x: 'a', ts: 1, id: '../evil' }] }, null);
	return v.msgs.length === 1 && v.msgs[0].id === null
})());

console.log('=== test-export: merge / dedupe ===');
const existing = [{ id: 'msg00000001', text: 'old' }, { text: 'no-id entry' }];
const fresh = [
	{ k: 'me', t: 'text', x: 'dupe', ts: 1000, id: 'msg00000001' },
	{ k: 'other', t: 'text', x: 'new', ts: 2000, id: 'msg00000009', u: 'bob' },
	{ k: 's', x: 'sys', ts: 1500 }
];
const { toAppend, dup } = mergeArchiveMessages(existing, fresh);
check('duplicate id skipped and counted', dup === 1 && toAppend.length === 2);
check('no-id entries always appended', toAppend.some(m => m.k === 's'));
check('merge cap respected', mergeArchiveMessages([], Array.from({ length: 6000 }, (_, i) => ({ k: 'me', t: 'text', x: 'a', ts: i, id: 'id' + String(i).padStart(8, '0') }))).toAppend.length === 5000);

console.log(`\ntest-export: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// Smoke test for util.localHistory.js (Node 22 webcrypto + localStorage shim)
import {
	deriveHistoryKey,
	setupRoomHistory,
	appendLocalHistory,
	loadLocalHistory,
	clearAllLocalHistory,
	isLocalHistoryEnabled,
	HISTORY_ITERATIONS,
	HISTORY_LEGACY_ITERATIONS,
	bytesToBase64,
	base64ToBytes,
	decodeStoredHistoryBlob,
	HISTORY_FORMAT_V2
} from './client/js/util.localHistory.js';

let passed = 0, failed = 0;
const t = (name, fn) => tests.push([name, fn]);
const tests = [];
const run = async () => {
	for (const [name, fn] of tests) {
		try { await fn(); console.log('PASS', name); passed++; }
		catch (e) { console.log('FAIL', name, '::', e.message); failed++; }
	}
};

// localStorage shim (backed by a plain map)
const store = new Map();
globalThis.localStorage = {
	getItem: k => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: k => store.delete(k),
	key: i => Array.from(store.keys())[i] || null,
	get length() { return store.size; }
};
globalThis.window = { dispatchEvent: () => {} };


t('isLocalHistoryEnabled defaults to false', () => {
	if (isLocalHistoryEnabled() !== false) throw new Error('should be off by default');
});

t('setupRoomHistory no-ops (no key) when disabled', async () => {
	const rd = {};
	const h = await setupRoomHistory(rd, 'room1', 'pw');
	if (h !== null || rd.historyKey !== null) throw new Error('expected null key');
	appendLocalHistory(rd, { type: 'me', text: 'x', timestamp: 1 });
	if (store.size !== 0) throw new Error('nothing should be written while disabled');
});

t('append+flush writes GCM ciphertext, roundtrip via loadLocalHistory', async () => {
	localStorage.setItem('settings', JSON.stringify({ localHistory: true }));
	const rd = {};
	const hash = await setupRoomHistory(rd, 'room1', 'secretpw');
	if (!rd.historyKey) throw new Error('key not derived');
	appendLocalHistory(rd, { type: 'me', text: 'hello 世界', msgType: 'text', timestamp: 111 });
	appendLocalHistory(rd, { type: 'other', text: 'hi back', userName: 'bob', msgType: 'text', timestamp: 222 });
	// wait for debounce flush
	await new Promise(r => setTimeout(r, 1000));
	const key = 'jmlt_hist:' + hash;
	const raw = store.get(key);
	if (!raw) throw new Error('no blob stored');
	if (raw.includes('hello 世界')) throw new Error('PLAINTEXT LEAKED into storage!');
	const entries = await loadLocalHistory('room1', 'secretpw', hash);
	if (entries.length !== 2) throw new Error('expected 2 entries, got ' + entries.length);
	if (entries[0].text !== 'hello 世界' || entries[1].userName !== 'bob') throw new Error('entry mismatch');
});

t('wrong password reads nothing', async () => {
	localStorage.setItem('settings', JSON.stringify({ localHistory: true }));
	const hash = 'b'.repeat(64);
	const rd = {};
	await setupRoomHistory(rd, 'room2', 'rightpw');
	appendLocalHistory(rd, { type: 'me', text: 'secret msg', timestamp: 1 });
	await new Promise(r => setTimeout(r, 1000));
	const entries = await loadLocalHistory('room2', 'wrongpw', hash);
	if (entries.length !== 0) throw new Error('wrong password must read nothing');
});

t('clearAllLocalHistory wipes storage and dispatches event', async () => {
	let eventFired = false;
	globalThis.window.dispatchEvent = () => { eventFired = true; };
	const n = clearAllLocalHistory();
	if (n === 0) throw new Error('expected at least 1 blob removed');
	const residual = Array.from(store.keys()).filter(k => k.indexOf('jmlt_hist:') === 0);
	if (residual.length !== 0) throw new Error('hist blobs not empty after clear: ' + residual.join(','));
	if (!eventFired) throw new Error('localHistoryCleared event not dispatched');
});

t('oversized entries are slimmed, not dropped silently at quota', async () => {
	localStorage.setItem('settings', JSON.stringify({ localHistory: true }));
	const rd = {};
	await setupRoomHistory(rd, 'room3', 'pw3');
	appendLocalHistory(rd, { type: 'me', text: 'X'.repeat(200 * 1024), timestamp: 1 }); // 200KB > 100KB slim threshold
	if (rd.historyBuffer[0].text.length >= 200 * 1024) throw new Error('oversized entry not slimmed');
	if (!rd.historyBuffer[0].omitted) throw new Error('missing omitted marker');
});

t('PBKDF2 600k upgrade: v1 (200k) blob still loads, new flush writes v2 (item 36)', async () => {
	if (HISTORY_ITERATIONS !== 600000 || HISTORY_LEGACY_ITERATIONS !== 200000) throw new Error('iteration constants wrong');
	localStorage.setItem('settings', JSON.stringify({ localHistory: true }));
	const hash = 'c'.repeat(64);
	// Hand-build a legacy v1 blob exactly as pre-upgrade code wrote it:
	// key derived at 200k, blob.v = 1.
	const legacyKey = await deriveHistoryKey('legacypw', hash, HISTORY_LEGACY_ITERATIONS);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKey,
		new TextEncoder().encode(JSON.stringify([{ type: 'me', text: 'old entry', timestamp: 7 }])));
	store.set('jmlt_hist:' + hash, JSON.stringify({ v: 1, iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) }));
	const entries = await loadLocalHistory('roomX', 'legacypw', hash);
	if (entries.length !== 1 || entries[0].text !== 'old entry') throw new Error('v1 blob did not load via 200k fallback');
	// New writes are v2.
	const rd = {};
	const h2 = await setupRoomHistory(rd, 'room4', 'pw4');
	appendLocalHistory(rd, { type: 'me', text: 'fresh entry', timestamp: 9 });
	await new Promise(r => setTimeout(r, 1000));
	const blob2 = JSON.parse(store.get('jmlt_hist:' + h2));
	if (!blob2 || blob2.v !== 2) throw new Error('new flush did not write v2 blob, got v=' + (blob2 && blob2.v));
	const back = await loadLocalHistory('room4', 'pw4', h2);
	if (back.length !== 1 || back[0].text !== 'fresh entry') throw new Error('v2 blob roundtrip failed');
});
t('base64 codec round-trips and v2 blob is much smaller than v1 arrays', () => {
	const bytes = new Uint8Array(1024);
	for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
	const back = base64ToBytes(bytesToBase64(bytes));
	if (!back || back.length !== bytes.length) throw new Error('roundtrip length mismatch');
	for (let i = 0; i < bytes.length; i++) if (back[i] !== bytes[i]) throw new Error('roundtrip byte mismatch at ' + i);
	if (base64ToBytes('!!!not-base64!!!') !== null && base64ToBytes(42) !== null) throw new Error('invalid base64 must yield null');
	const v1 = JSON.stringify({ v: 1, iv: Array.from(bytes.slice(0, 12)), ct: Array.from(bytes) });
	const v2 = JSON.stringify({ v: 2, iv: bytesToBase64(bytes.slice(0, 12)), ct: bytesToBase64(bytes) });
	if (v2.length > v1.length * 0.45) throw new Error('v2 not ~60-70% smaller: v1=' + v1.length + ' v2=' + v2.length);
	const dec = decodeStoredHistoryBlob(JSON.parse(v2));
	if (!dec || dec.ct.length !== 1024) throw new Error('v2 decode failed');
	const dec1 = decodeStoredHistoryBlob(JSON.parse(v1));
	if (!dec1 || dec1.ct.length !== 1024) throw new Error('v1 decode failed');
	if (decodeStoredHistoryBlob({ v: 99, iv: [], ct: [] }) !== null) throw new Error('unknown version must be rejected');
});

t('v1 legacy sample reads, migrates to v2 on flush, re-reads identically', async () => {
	localStorage.setItem('settings', JSON.stringify({ localHistory: true }));
	const rd = {};
	const hash = await setupRoomHistory(rd, 'roomMig', 'pwMig');
	if (!hash || !rd.historyKey) throw new Error('setup failed');
	// Craft a v1 blob exactly as the old code wrote it (number arrays).
	const key = await deriveHistoryKey('pwMig', hash, HISTORY_LEGACY_ITERATIONS);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const legacyEntries = [
		{ type: 'me', text: 'legacy 历史 one', msgType: 'text', timestamp: 42 },
		{ type: 'other', text: 'second', userName: 'amy', msgType: 'text', timestamp: 43 }
	];
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
		new TextEncoder().encode(JSON.stringify(legacyEntries)));
	const storeKey = 'jmlt_hist:' + hash;
	store.set(storeKey, JSON.stringify({ v: 1, iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) }));
	// 1) old format must read back — no data loss
	const read1 = await loadLocalHistory('roomMig', 'pwMig', hash);
	if (read1.length !== 2 || read1[0].text !== 'legacy 历史 one' || read1[1].userName !== 'amy') {
		throw new Error('v1 legacy read mismatch: ' + JSON.stringify(read1));
	}
	if (read1[0].text && store.get(storeKey).includes('legacy')) throw new Error('PLAINTEXT LEAKED in v1 blob!');
	// 2) next flush (triggered by a new append) must rewrite as v2 base64
	rd.historyBuffer = read1.slice();
	appendLocalHistory(rd, { type: 'me', text: 'fresh after migration', msgType: 'text', timestamp: 44 });
	await new Promise(r => setTimeout(r, 1000));
	const raw2 = JSON.parse(store.get(storeKey));
	if (raw2.v !== HISTORY_FORMAT_V2) throw new Error('flush did not write v2, got v=' + raw2.v);
	if (typeof raw2.ct !== 'string' || typeof raw2.iv !== 'string') throw new Error('v2 iv/ct must be base64 strings');
	if (store.get(storeKey).includes('fresh after migration')) throw new Error('PLAINTEXT LEAKED in v2 blob!');
	// 3) re-read of the migrated blob must be identical + the new entry
	const read2 = await loadLocalHistory('roomMig', 'pwMig', hash);
	if (read2.length !== 3) throw new Error('expected 3 entries after migration, got ' + read2.length);
	if (read2[0].text !== 'legacy 历史 one' || read2[1].text !== 'second' || read2[2].text !== 'fresh after migration') {
		throw new Error('post-migration entries mismatch');
	}
	// 4) wrong password still reads nothing from the v2 blob
	const wrong = await loadLocalHistory('roomMig', 'nope', hash);
	if (wrong.length !== 0) throw new Error('wrong password must read nothing (v2)');
});

await run();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

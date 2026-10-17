// Smoke test for util.localHistory.js (Node 22 webcrypto + localStorage shim)
import {
	deriveHistoryKey,
	setupRoomHistory,
	appendLocalHistory,
	loadLocalHistory,
	clearAllLocalHistory,
	isLocalHistoryEnabled
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

const CH = 'a'.repeat(64); // fake channel hash

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
	const hash = await setupRoomHistory(rd, 'room3', 'pw3');
	appendLocalHistory(rd, { type: 'me', text: 'X'.repeat(200 * 1024), timestamp: 1 }); // 200KB > 100KB slim threshold
	if (rd.historyBuffer[0].text.length >= 200 * 1024) throw new Error('oversized entry not slimmed');
	if (!rd.historyBuffer[0].omitted) throw new Error('missing omitted marker');
});

await run();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

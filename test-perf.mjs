// ==================== upgrade/client-perf batch tests ====================
// Covers review items #11 (push subs DO memory cache), #12 (file progress
// throttle), #13 (reconnect exponential backoff + jitter), #16 (large-room
// file frame pre-check), #26 (received-file Blob cache + release), #28
// (Node fanout backpressure decision), #30 (sync replay suppression gate).
// 覆盖评审条目 #11/#12/#13/#16/#26/#28/#30。
// Run: node test-perf.mjs

let passed = 0, failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name); }
	else { failed++; console.log('  ✗ FAIL: ' + name); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- #13 + #16: NodeCrypt pure helpers (esbuild bundle, same as
// test-ratchet-integration — Node's raw loader chokes on elliptic CJS) ----
globalThis.window = globalThis;
const { build } = await import('esbuild');
await build({
	entryPoints: ['client/js/NodeCrypt.js'],
	bundle: true, format: 'esm', platform: 'node',
	banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
	outfile: '.tmp-nodecrypt-perf.mjs', logLevel: 'silent'
});
const { NodeCrypt, computeReconnectDelay, estimateChannelFrameBytes, estimateRoomFileLimitBytes, FRAME_LIMIT_BYTES } = await import('./.tmp-nodecrypt-perf.mjs');

console.log('=== perf #13: reconnect backoff sequence ===');
{
	// rand=0 → exactly 0.5×base; bases: 1s,2s,4s,8s,16s,30s(cap),30s
	const seq = [0, 1, 2, 3, 4, 5, 6, 10].map(a => computeReconnectDelay(a, 0));
	check('backoff base sequence 1s→30s cap (rand=0 gives 0.5x)',
		JSON.stringify(seq) === JSON.stringify([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]));
	// rand→1 gives just under 1.5×base, never above the 30s cap × 1.5
	const hi = [0, 1, 2, 3, 4, 5, 6].map(a => computeReconnectDelay(a, 0.999999));
	check('jitter upper bound ≤ 1.5x base (rounding)', hi[0] <= 1500 && hi[4] <= 24000 && hi[6] <= 45000);
	// every delay within [0.5x, 1.5x) of its base for random jitter
	let inRange = true;
	for (let a = 0; a <= 8; a++) {
		const base = Math.min(30000, 1000 * Math.pow(2, Math.min(a, 5)));
		for (let i = 0; i < 50; i++) {
			const d = computeReconnectDelay(a, Math.random());
			if (d < base * 0.5 || d >= base * 1.5) inRange = false;
		}
	}
	check('random jitter always within ±50% of base', inRange);
	// instance wiring: startReconnect consumes increasing attempts
	const nc = new NodeCrypt({}, {});
	const delays = [];
	const realSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = (fn, ms) => { delays.push(ms); return 0; };
	try {
		nc.startReconnect(); nc.startReconnect(); nc.startReconnect();
	} finally { globalThis.setTimeout = realSetTimeout; }
	check('startReconnect uses backoff (3 calls, non-fixed, within cap range)',
		delays.length === 3 && delays.every(d => d >= 500 && d < 45000) && new Set(delays.map(d => Math.round(d / 100) )).size >= 2);
	check('reconnectAttempts increments', nc.reconnectAttempts === 3);
}

console.log('=== perf #16: channel frame pre-check ===');
{
	check('one 256KB volume copy estimate ≈ 470KB', (() => {
		const one = estimateChannelFrameBytes(1, 342000);
		return one > 440 * 1024 && one < 500 * 1024;
	})());
	check('20 members × one volume exceeds the 8MB frame limit',
		estimateChannelFrameBytes(20, 342000) > FRAME_LIMIT_BYTES);
	check('room file limit decreases with member count',
		estimateRoomFileLimitBytes(2) > estimateRoomFileLimitBytes(10) &&
		estimateRoomFileLimitBytes(10) > estimateRoomFileLimitBytes(100));
	check('solo room file limit ≈ 8MB × 256/470 (≈4.36MB)',
		Math.abs(estimateRoomFileLimitBytes(1) - Math.floor(FRAME_LIMIT_BYTES * 256 / 470)) < 1024);
	// integration: sendChannelMessage refuses BEFORE encrypting and fires
	// the explicit notice callback instead of returning false silently.
	let notice = null;
	const nc = new NodeCrypt({}, { onChannelFrameTooLarge: (info) => { notice = info; } });
	nc.serverShared = Buffer.alloc(32, 7);
	nc.connection = { readyState: 1, send() { throw new Error('must not send'); } };
	for (let i = 0; i < 20; i++) nc.channel['peer' + i] = { shared: Buffer.alloc(32, 1), username: 'u' + i };
	const r = nc.sendChannelMessage('file_volume', { type: 'file_volume', fileId: 'f1', volumeData: 'x'.repeat(340000) });
	check('oversize channel send returns false', r === false);
	check('oversize notice fired with member count + approx limit',
		!!notice && notice.memberCount === 20 && notice.limitBytes === estimateRoomFileLimitBytes(20));
}

// ---------- #30: sync suppression gate + delay ---------------------------
console.log('=== perf #30: sync replay suppression ===');
{
	const { SyncReplyGate, syncReplyDelayMs } = await import('./client/js/util.validate.js');
	check('reply delay floor is 250ms', syncReplyDelayMs(0) === 250);
	check('reply delay stays under 1750ms', syncReplyDelayMs(0.999999) < 1750 && syncReplyDelayMs(0.5) >= 250);
	const g = new SyncReplyGate();
	check('request registers a pending reply', g.noteRequest('peerA') === true && g.shouldSend('peerA') === true);
	check('sync-done suppresses the pending reply', g.noteSyncDone('peerA') === true && g.shouldSend('peerA') === false);
	// sole holder: no sync-done ever arrives → reply must still go out
	const g2 = new SyncReplyGate();
	g2.noteRequest('onlyHolder');
	check('sole holder is never suppressed without a sync-done', g2.shouldSend('onlyHolder') === true);
	// fallback re-request after suppression starts a fresh episode
	g.resetEpisode('peerA');
	check('fresh episode clears suppression (fallback re-request works)',
		g.noteRequest('peerA') === true && g.shouldSend('peerA') === true);
}

// ---------- #11: worker push subscription cache --------------------------
console.log('=== perf #11: push subs DO memory cache ===');
{
	const { ChatRoom } = await import('./worker/index.js');
	let pushSubsGets = 0;
	const store = new Map([['rsaKeyPair', { rsaPublic: 'stub', createdAt: Date.now() }]]);
	const state = {
		storage: {
			async get(k) { if (k === 'pushSubs') pushSubsGets++; return store.get(k); },
			async put(k, v) { store.set(k, v); },
			async delete(k) { store.delete(k); }
		}
	};
	const room = new ChatRoom(state, {});
	const ep = 'https://fcm.googleapis.com/fcm/send/dummy-token-123';
	await room.getPushSubs(); await room.getPushSubs(); await room.getPushSubs();
	check('repeated getPushSubs hits storage once (cache warm)', pushSubsGets === 1);
	await room.handlePushSubscribe('c1', { p: ep });
	const after = await room.getPushSubs();
	check('subscribe visible via cache without another storage read',
		pushSubsGets === 1 && !!after[ep]);
	check('subscribe persisted to storage', !!store.get('pushSubs')[ep]);
	await room.handlePushUnsubscribe('c1', { p: ep });
	const afterUn = await room.getPushSubs();
	check('unsubscribe invalidates cache entry', pushSubsGets === 1 && !afterUn[ep]);
	// fresh DO instance (post-eviction) refills from storage on first read
	await room.handlePushSubscribe('c1', { p: ep });
	const room2 = new ChatRoom(state, {});
	const refilled = await room2.getPushSubs();
	check('post-eviction instance refills cache from storage', !!refilled[ep] && pushSubsGets === 2);
}

// ---------- #28: Node backpressure decision ------------------------------
console.log('=== perf #28: server backpressure ===');
{
	process.env.PORT = '18931';
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const srv = require('./server/server.js');
	const bp = srv.backpressureAction;
	const now = 1000000;
	check('empty queue sends', bp(0, 0, now, false).action === 'send');
	check('exactly one max frame (8MB) still sends', bp(srv.BP_SOFT_BYTES, 0, now, false).action === 'send');
	const over = bp(srv.BP_SOFT_BYTES + 1, 0, now, false);
	check('over threshold: non-critical dropped, overSince armed', over.action === 'drop' && over.overSince === now);
	check('critical frame never dropped', bp(srv.BP_SOFT_BYTES + 1, 0, now, true).action === 'send');
	check('briefly over still drops (not closes)', bp(srv.BP_SOFT_BYTES + 1, now - 1000, now, false).action === 'drop');
	check('sustained 20s over closes even for critical', bp(srv.BP_SOFT_BYTES + 1, now - srv.BP_SUSTAIN_MS, now, true).action === 'close');
	check('queue drained resets overSince', bp(1024, now - 999999, now, false).overSince === 0);
}

// ---------- #12 + #26: file progress throttle + Blob cache/release -------
console.log('=== perf #12/#26: file receive memory ===');
{
	// DOM stubs (same pattern as test-filestream, plus a counting
	// querySelectorAll and element stubs for the progress renderer).
	let scans = 0;
	const mkEl = () => ({
		style: {}, textContent: '',
		classList: { add() {}, remove() {} },
		querySelector: () => mkEl()
	});
	globalThis.window = { addEventListener() {}, fileTransfers: new Map() };
	globalThis.document = {
		addEventListener() {},
		querySelector: () => null,
		querySelectorAll: () => { scans++; return [mkEl()]; }
	};
	const { deflateSync } = await import('fflate');
	const { sha256 } = await import('js-sha256');
	const mod = await import('./client/js/util.file.js');
	const { updateFileProgress, getTransferBlob, releaseTransferData, RECEIVED_RETENTION_MS } = mod;

	check('received retention is 30 minutes', RECEIVED_RETENTION_MS === 30 * 60 * 1000);

	// #12: 10 rapid progress updates → 1 immediate scan + 1 trailing scan
	const t1 = {
		status: 'receiving', receivedVolumes: new Set([0]), totalVolumes: 10,
		volumeData: ['x'], sentVolumes: 0
	};
	window.fileTransfers.set('fid12', t1);
	for (let i = 0; i < 10; i++) updateFileProgress('fid12');
	check('rapid progress updates throttled to a single scan', scans === 1);
	await sleep(160);
	check('trailing throttled render fires once', scans === 2);
	t1.status = 'completed';
	updateFileProgress('fid12');
	check('terminal state renders immediately', scans === 3);

	// #26: first decode caches the Blob and releases volume originals
	const raw = new Uint8Array(5000);
	for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + 7) & 0xff;
	const compressed = deflateSync(raw);
	const b64 = Buffer.from(compressed).toString('base64');
	const t2 = {
		status: 'completed', fileName: 'data.bin', isArchive: false,
		volumeData: [b64], originalHash: sha256(raw),
		receivedVolumes: new Set([0]), totalVolumes: 1
	};
	window.fileTransfers.set('fid26', t2);
	const blob1 = await getTransferBlob('fid26');
	check('first decode returns a Blob of the original size', !!blob1 && blob1.size === raw.length);
	check('volume originals released after first decode', t2.volumeData === null);
	const blob2 = await getTransferBlob('fid26');
	check('second decode serves the cached Blob (same instance)', blob2 === blob1);
	check('manual release succeeds on a completed transfer', releaseTransferData('fid26') === true);
	check('released transfer drops cache + shows released status',
		t2.blobCache === null && t2.status === 'released');
	check('getTransferBlob after release returns null (UI explains, no throw)',
		(await getTransferBlob('fid26')) === null);
	check('double release is a no-op', releaseTransferData('fid26') === false);
}

console.log(`\ntest-perf: ${passed} passed, ${failed} failed`);
const { unlinkSync } = await import('node:fs');
try { unlinkSync('.tmp-nodecrypt-perf.mjs'); } catch (_e) {}
process.exit(failed > 0 ? 1 : 0);

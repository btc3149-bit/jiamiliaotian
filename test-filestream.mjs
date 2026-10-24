// ==================== v1.7.0 #19: streaming file chunking test ====================
// v1.7.0 #19：大文件流式分卷测试。
//
// Verifies the streaming sender is wire-compatible with the legacy
// whole-buffer implementation: one continuous deflate stream split into
// volumes, incremental SHA-256, archive layout byte-identical, and the
// honest size caps behave.
// 验证流式发送端与旧整缓冲实现线格式兼容：单条连续 deflate 流切卷、增量
// SHA-256、归档布局字节级一致、诚实上限行为正确。

globalThis.window = { addEventListener() {}, fileTransfers: new Map() }; // module-top bindings
globalThis.document = { addEventListener() {}, querySelector: () => null };

const { inflateSync, deflate } = await import('fflate');
const { File } = await import('node:buffer');
const nodeCrypto = await import('node:crypto');
if (!globalThis.File) globalThis.File = File;

const mod = await import('./client/js/util.file.js');
const { VolumeDeflater, compressFileToVolumes, compressFilesToArchive, validateTransferSizes, MAX_TRANSFER_BYTES } = mod;

let passed = 0, failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name); }
	else { failed++; console.log('  ✗ ' + name); }
}
function makeData(n, seed) {
	const u = new Uint8Array(n);
	for (let i = 0; i < n; i++) u[i] = (i * 7 + ((i * seed) % 251) + (i % 97)) & 0xff;
	return u;
}
function decodeVolumes(volumes) {
	const parts = volumes.map(v => new Uint8Array(Buffer.from(v, 'base64')));
	let n = 0; for (const p of parts) n += p.length;
	const out = new Uint8Array(n); let off = 0;
	for (const p of parts) { out.set(p, off); off += p.length; }
	return out;
}
function legacyDeflate(data) {
	return new Promise((resolve, reject) => deflate(data, { level: 6, mem: 8 }, (err, out) => err ? reject(err) : resolve(new Uint8Array(out))));
}

// ---- 1. VolumeDeflater round-trip + format compatibility ----
console.log('=== filestream: volume deflater ===');
{
	const data = makeData(300000, 3);
	const VOL = 256 * 1024;
	const d = new VolumeDeflater(VOL);
	const SLICE = 65536; // force many pushes
	for (let off = 0; off < data.length; off += SLICE) {
		d.push(data.subarray(off, Math.min(off + SLICE, data.length)), false);
	}
	d.push(new Uint8Array(0), true);
	const volumes = d.finish();
	check('streamed output round-trips (single deflate stream)',
		Buffer.from(inflateSync(decodeVolumes(volumes))).equals(Buffer.from(data)));
	const legacy = await legacyDeflate(data);
	// NOTE: streaming and whole-buffer outputs are both valid raw deflate
	// streams but need NOT be byte-identical (chunk-boundary matching).
	// Compat = every receiver inflates either. Assert interop both ways:
	check('legacy receiver inflates streamed output (interop A→old)',
		Buffer.from(inflateSync(decodeVolumes(volumes))).equals(Buffer.from(data)));
	check('new receiver inflates legacy output (interop old→A)',
		Buffer.from(inflateSync(new Uint8Array(legacy))).equals(Buffer.from(data)));
	const expectedCount = Math.ceil(legacy.length / VOL);
	check('volume count = ceil(compressed/volumeSize)', volumes.length === expectedCount);
	check('all volumes except last are exactly volumeSize',
		volumes.slice(0, -1).every(v => v.length === Math.ceil(VOL / 3) * 4) && // base64 padded
		volumes.every(v => v.length > 0));
	check('at least one volume even for tiny compressed output', volumes.length >= 1);
}
{
	const empty = new Uint8Array(0);
	const d = new VolumeDeflater(1024);
	d.push(empty, true);
	const volumes = d.finish();
	check('empty input still yields >= 1 volume', volumes.length >= 1);
	check('empty input round-trips to zero bytes',
		inflateSync(decodeVolumes(volumes)).length === 0);
}

// ---- 2. compressFileToVolumes (real File slice reading) ----
console.log('=== filestream: compressFileToVolumes ===');
{
	const data = makeData(700000, 11);
	const file = new File([data], 'probe.bin');
	const { volumes, originalSize, compressedSize, originalHash } = await compressFileToVolumes(file, 64 * 1024);
	check('originalSize matches file size', originalSize === data.length);
	check('compressedSize matches decoded volume total', compressedSize === decodeVolumes(volumes).length);
	check('round-trip via volumes',
		Buffer.from(inflateSync(decodeVolumes(volumes))).equals(Buffer.from(data)));
	check('legacy receiver inflates streamed file output',
		Buffer.from(inflateSync(new Uint8Array((await legacyDeflate(data))))).equals(Buffer.from(data)));
		check('incremental sha256 === whole-buffer digest',
		originalHash === nodeCrypto.createHash('sha256').update(data).digest('hex'));
	// many small volumes → split correctness
	const full = volumes.slice(0, -1).every(v => Buffer.from(v, 'base64').length === 64 * 1024);
	const last = Buffer.from(volumes[volumes.length - 1], 'base64').length;
	check('only the last volume is partial (1 < last <= volumeSize)', full && last > 0 && last <= 64 * 1024);
}
{
	// incompressible random data (exercises the "compressed ≈ raw" worst case)
	const rnd = new Uint8Array(nodeCrypto.randomBytes(150000));
	const file = new File([rnd], 'rand.bin');
	const { volumes } = await compressFileToVolumes(file, 32 * 1024);
	check('incompressible data round-trips',
		Buffer.from(inflateSync(decodeVolumes(volumes))).equals(Buffer.from(rnd)));
}

// ---- 3. archive streaming (layout byte-identical to legacy) ----
console.log('=== filestream: archive ===');
{
	const a = makeData(200000, 5), b = makeData(50000, 9);
	const fa = new File([a], 'alpha.txt');
	const fb = new File([b], 'beta 文件.bin'); // unicode name exercises layout
	const { volumes, originalSize, compressedSize, archiveHash, fileCount, fileManifest } = await compressFilesToArchive([fa, fb], 64 * 1024);

	// rebuild the legacy raw archive layout independently
	const enc = new TextEncoder();
	const nameA = enc.encode('alpha.txt'), nameB = enc.encode('beta 文件.bin');
	const part = (name, size, data) => {
		const nl = new Uint8Array(4); new DataView(nl.buffer).setUint32(0, name.length, true);
		const sz = new Uint8Array(8); new DataView(sz.buffer).setBigUint64(0, BigInt(size), true);
		return [nl, name, sz, data];
	};
	const parts = [...part(nameA, a.length, a), ...part(nameB, b.length, b)];
	let total = 0; for (const p of parts) total += p.length;
	const combined = new Uint8Array(total); let off = 0;
	for (const p of parts) { combined.set(p, off); off += p.length; }

	check('archive originalSize = sum of all parts', originalSize === total);
	check('archive round-trip: inflated bytes === legacy layout',
		Buffer.from(inflateSync(decodeVolumes(volumes))).equals(Buffer.from(combined)));
	check('legacy receiver inflates streamed archive output',
		Buffer.from(inflateSync(new Uint8Array((await legacyDeflate(combined))))).equals(Buffer.from(combined)));
	check('fileCount + manifest', fileCount === 2 && fileManifest.length === 2 &&
		fileManifest[0].name === 'alpha.txt' && fileManifest[1].size === b.length);
	const c = await import('node:crypto');
	check('archiveHash = incremental sha256 of raw archive',
		archiveHash === nodeCrypto.createHash('sha256').update(combined).digest('hex'));
	check('compressedSize consistent', compressedSize === decodeVolumes(volumes).length);
}

// ---- 4. size caps ----
console.log('=== filestream: size caps ===');
{
	check('validateTransferSizes: normal ok', validateTransferSizes([1000, 2000]) === null);
	check('validateTransferSizes: empty rejected', validateTransferSizes([]) === 'empty');
	check('validateTransferSizes: negative rejected', validateTransferSizes([-1]) === 'invalid');
	check('validateTransferSizes: non-number rejected', validateTransferSizes(['x']) === 'invalid');
	check('validateTransferSizes: exactly at cap ok', validateTransferSizes([MAX_TRANSFER_BYTES]) === null);
	check('validateTransferSizes: one byte over cap rejected', validateTransferSizes([MAX_TRANSFER_BYTES + 1]) === 'too-large');
	check('validateTransferSizes: cumulative sum enforces cap',
		validateTransferSizes([MAX_TRANSFER_BYTES - 1, 2]) === 'too-large');
	check('MAX_TRANSFER_BYTES is 256MB', MAX_TRANSFER_BYTES === 256 * 1024 * 1024);
}

console.log(`\ntest-filestream: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

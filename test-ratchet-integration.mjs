// ==================== v1.6.0 #15: NodeCrypt ratchet integration test ====================
// v1.6.0 #15：NodeCrypt ratchet 集成测试。
//
// Drives TWO real NodeCrypt instances through the full KV2 lifecycle using
// stubbed WebSocket transports — no mocks of the crypto itself:
//   capability handshake ('u' → 'cap') → chain round-trips → replay &
//   downgrade guards → full rekey handshake ('rk'/'rka') → transition
//   window → post-rekey traffic.
// 用两个真实 NodeCrypt 实例 + 桩 WebSocket 传输层跑通 KV2 全生命周期：
//   能力协商（'u'→'cap'）→ 链往返 → 重放/降级防护 → 完整 rekey 握手
//   （'rk'/'rka'）→ 过渡窗口 → rekey 后流量。加密本身零 mock。

globalThis.window = globalThis; // NodeCrypt assigns window.Buffer at import

// Node's raw ESM loader chokes on elliptic's CJS named exports (the browser
// build via Vite is unaffected). Bundle NodeCrypt with esbuild (vite's own
// dependency) into a temp ESM file and import that.
// Node 原生 ESM 加载器无法解析 elliptic 的 CJS 具名导出（Vite 浏览器构建不受
// 影响）。用 esbuild（vite 自带依赖）把 NodeCrypt 打成临时 ESM 再导入。
import { build } from 'esbuild'; // vite's own dependency, no extra install
await build({
	entryPoints: ['client/js/NodeCrypt.js'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
	outfile: '.tmp-nodecrypt.mjs',
	logLevel: 'silent'
});

const { NodeCrypt } = await import('./.tmp-nodecrypt.mjs');
const { ec: elliptic } = await import('elliptic').then(m => m.default || m);
const { Buffer } = await import('buffer');

const ec = new elliptic('curve25519');
const PASS = 'ab'.repeat(32); // simulated stretched password hex (64 chars)
let passed = 0, failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name); }
	else { failed++; console.log('  ✗ ' + name); }
}

function makeInstance(name) {
	const nc = new NodeCrypt({}, {});
	nc.credentials = { username: name, channel: 'roomhash', password: PASS };
	nc.serverShared = Buffer.alloc(32, 7); // shared fake transport key
	return nc;
}

// Establish channel entries the same way the 'c' handshake does.
// 按既有 'c' 握手的方式建立双方的通道条目。
function establish(ncA, idA, ncB, idB) {
	const kpA = ec.genKeyPair(), kpB = ec.genKeyPair();
	const pubA = kpA.getPublic('hex'), pubB = kpB.getPublic('hex');
	ncA.channel[idB] = { username: null, keys: kpA, shared: null, kv2: false, peerPub: pubB };
	ncB.channel[idA] = { username: null, keys: kpB, shared: null, kv2: false, peerPub: pubA };
	const derive = (mine, theirsPub) =>
		Buffer.from(ncA.xorHex(
			mine.derive(ec.keyFromPublic(theirsPub, 'hex').getPublic()).toString('hex').padEnd(64, '8').substr(0, 64),
			PASS), 'hex');
	ncA.channel[idB].shared = derive(kpA, pubB);
	ncB.channel[idA].shared = derive(kpB, pubA);
	return { pubA, pubB, isFirstA: pubA < pubB };
}

// Server stub: unwrap a captured outbound envelope and re-address it as if
// the server had relayed it (server rewrites c to the SENDER's id).
// 服务器桩：解包捕获的出站信封并按服务器中继后的形式重新编址（服务器会把
// c 改写为发送方 id）。
function relay(captured, fromNc, toNc, fromId) {
	const dec = fromNc.decryptServerMessage(captured, fromNc.serverShared);
	return toNc.encryptServerMessage({ a: 'c', p: dec.p, c: fromId }, toNc.serverShared);
}

function stubTransport(nc, sink) {
	nc.connection = { readyState: 1, send: (m) => { if (sink) sink.push(m); } };
}

const A = makeInstance('alice');
const B = makeInstance('bob');
const ids = { A: 'clientA', B: 'clientB' };
const { isFirstA } = establish(A, ids.A, B, ids.B);

// ---- 1. capability handshake: both 'u's cross first, then both 'cap's ----
// （真实顺序：双方 'u' 先交换完成、username 就位，'cap' 才能通过 username 守卫）
console.log('=== integration: capability handshake ===');
let capFromB, capFromA;
{
	let bOut = [];
	stubTransport(B, bOut);
	const uFromA = A.encryptClientMessage({ a: 'u', p: 'alice' }, A.channel[ids.B].shared);
	await B.onMessage({ data: relay(
		A.encryptServerMessage({ a: 'c', p: uFromA, c: ids.B }, A.serverShared),
		A, B, ids.A) });
	check('u processed: B knows peer username', B.channel[ids.A].username === 'alice');
	check('B sent exactly one reply', bOut.length === 1);
	const capDec = B.decryptServerMessage(bOut[0], B.serverShared);
	const capInner = B.decryptPeerMessage(capDec.p, ids.A);
	check('reply is legacy cap kv:2', capInner && capInner.a === 'cap' && capInner.kv === 2);
	capFromB = bOut[0]; // B's cap, to be delivered to A later
}
{
	let aOut = [];
	stubTransport(A, aOut);
	const uFromB = B.encryptClientMessage({ a: 'u', p: 'bob' }, B.channel[ids.A].shared);
	await A.onMessage({ data: relay(
		B.encryptServerMessage({ a: 'c', p: uFromB, c: ids.A }, B.serverShared),
		B, A, ids.B) });
	check('A knows peer username', A.channel[ids.B].username === 'bob');
	const capDec = A.decryptServerMessage(aOut[0], A.serverShared);
	const capInner = A.decryptPeerMessage(capDec.p, ids.B);
	check('A replied cap kv:2', capInner && capInner.a === 'cap' && capInner.kv === 2);
	capFromA = aOut[0]; // A's cap, to be delivered to B later
}
{
	// now both usernames are set — deliver the crossed caps
	await A.onMessage({ data: relay(capFromB, B, A, ids.B) });
	await B.onMessage({ data: relay(capFromA, A, B, ids.A) });
	check('A flipped kv2 after receiving cap', A.channel[ids.B].kv2 === true);
	check('B flipped kv2 after receiving cap', B.channel[ids.A].kv2 === true);
}

// ---- 2. ratchet round-trips on both directions ----
console.log('=== integration: chain round-trip + guards ===');
let wireAB1, wireAB2, wireBA1;
{
	stubTransport(A, null); stubTransport(B, null);
	wireAB1 = A.encryptChannelMessage(ids.B, { a: 'm', t: 'text', d: 'hello', id: 'aaaa1111aaaa1111' });
	check('A→B wire uses KV2 prefix', typeof wireAB1 === 'string' && wireAB1.startsWith('KV2|'));
	const obj = B.decryptPeerMessage(wireAB1, ids.A);
	check('B decrypts A ratchet message', obj && obj.a === 'm' && obj.d === 'hello');
	wireAB2 = A.encryptChannelMessage(ids.B, { a: 'm', t: 'text', d: 'second', id: 'aaaa1111aaaa1112' });
	wireBA1 = B.encryptChannelMessage(ids.A, { a: 'm', t: 'text', d: 'pong', id: 'bbbb1111bbbb1111' });
	const obj2 = A.decryptPeerMessage(wireBA1, ids.B);
	check('A decrypts B ratchet message (independent direction)', obj2 && obj2.d === 'pong');
	check('replay of delivered wire rejected', Object.keys(B.decryptPeerMessage(wireAB1, ids.A)).length === 0);
	// downgrade guard: legacy-encrypted ELIGIBLE content refused post-kv2
	const legacyM = A.encryptClientMessage({ a: 'm', t: 'text', d: 'evil-downgrade' }, A.channel[ids.B].shared);
	check('downgraded legacy content refused', Object.keys(B.decryptPeerMessage(legacyM, ids.A)).length === 0);
	// legacy file volumes still pass (documented boundary)
	const legacyFile = A.encryptClientMessage({ a: 'm', t: 'file_chunk', d: 'bin' }, A.channel[ids.B].shared);
	const fileObj = B.decryptPeerMessage(legacyFile, ids.A);
	check('legacy file volume still accepted', fileObj && fileObj.a === 'm' && fileObj.t === 'file_chunk');
	// metadata actions still pass legacy (documented boundary)
	const legacyTyping = A.encryptClientMessage({ a: 't' }, A.channel[ids.B].shared);
	check('legacy metadata (typing) still accepted', B.decryptPeerMessage(legacyTyping, ids.A).a === 't');
}

// ---- 3. broadcast path: sendChannelMessage produces per-peer KV2 wires ----
console.log('=== integration: broadcast path ===');
{
	let aOut = [];
	stubTransport(A, aOut);
	const mid = A.sendChannelMessage('text', 'broadcast');
	check('sendChannelMessage returns a message id', typeof mid === 'string' && mid.length === 16);
	check('broadcast envelope captured', aOut.length === 1);
	const dec = A.decryptServerMessage(aOut[0], A.serverShared);
	const wire = dec.p && dec.p[ids.B];
	check('per-peer payload is a KV2 wire', typeof wire === 'string' && wire.startsWith('KV2|'));
	const obj = B.decryptPeerMessage(wire, ids.A);
	check('B decrypts broadcast through ratchet', obj && obj.a === 'm' && obj.d === 'broadcast');
}

// ---- 4. full rekey handshake ----
console.log('=== integration: rekey handshake ===');
{
	const initiator = isFirstA ? A : B;
	const responder = isFirstA ? B : A;
	const initId = isFirstA ? ids.A : ids.B;
	const respId = isFirstA ? ids.B : ids.A;
	check('exactly one side may initiate rekey',
		(initiator.channel[respId].ratchet.canInitiateRekey === true) &&
		(responder.channel[initId].ratchet.canInitiateRekey === false));
	let initOut = [];
	stubTransport(initiator, initOut);
	stubTransport(responder, null);
	check('initiateRekey accepted', initiator.initiateRekey(respId) === true);
	check('offer captured', initOut.length === 1);
	check('initiator still on gen 1 before ack', initiator.channel[respId].ratchet.activeGeneration() === 1);
	// relay the offer; responder seeds gen2, activates, and captures the ack
	let respOut = [];
	stubTransport(responder, respOut);
	await responder.onMessage({ data: relay(initOut[0], initiator, responder, initId) });
	check('responder activated gen 2 immediately', responder.channel[initId].ratchet.activeGeneration() === 2);
	check('responder sent ack', respOut.length === 1);
	// relay the ack; initiator switches its send side
	stubTransport(initiator, null);
	await initiator.onMessage({ data: relay(respOut[0], responder, initiator, respId) });
	check('initiator activated gen 2 after ack', initiator.channel[respId].ratchet.activeGeneration() === 2);
	// post-rekey traffic rides gen 2
	const wirePost = initiator.encryptChannelMessage(respId, { a: 'm', t: 'text', d: 'after-rekey', id: 'cccc1111cccc1111' });
	check('post-rekey wire is gen 2', wirePost.startsWith('KV2|2|'));
	const obj = responder.decryptPeerMessage(wirePost, initId);
	check('post-rekey message decrypts', obj && obj.d === 'after-rekey');
	// transition window: a gen-1 wire captured BEFORE the rekey still opens.
	// wireAB2 came from A, so it must open on B regardless of who initiated.
	const objOld = B.decryptPeerMessage(wireAB2, ids.A);
	check('gen-1 wire still opens during transition window',
		objOld && objOld.d === 'second' && B.channel[ids.A].ratchet.stats().generations.includes(1));
	// the non-initiator side must refuse to run initiateRekey
	check('non-initiator cannot initiate rekey', responder.initiateRekey(initId) === false);
}

console.log(`\ntest-ratchet-integration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

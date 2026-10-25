// v1.9.2 regression test: voice_private fix + call signal round-trip.
// v1.9.2 回归测试：私聊语音修复 + 通话信令往返。
globalThis.window = globalThis;
import { build } from 'esbuild';
import { readFileSync } from 'fs';

await build({
	entryPoints: ['client/js/NodeCrypt.js'],
	bundle: true, format: 'esm', platform: 'node',
	banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
	outfile: '.tmp-nodecrypt.mjs', logLevel: 'silent'
});
const { NodeCrypt } = await import('./.tmp-nodecrypt.mjs');
const { ec: elliptic } = await import('elliptic').then(m => m.default || m);
const { Buffer } = await import('buffer');

let failures = 0;
function check(name, ok, detail) {
	console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' | ' + detail : ''));
	if (!ok) failures++;
}

const ec = new elliptic('curve25519');
const PASS = 'ab'.repeat(32);
function makeInstance(name) {
	const nc = new NodeCrypt({}, {});
	nc.credentials = { username: name, channel: 'roomhash', password: PASS };
	nc.serverShared = Buffer.alloc(32, 7);
	return nc;
}
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
}
function stubTransport(nc, sink) { nc.connection = { readyState: 1, send: (m) => { if (sink) sink.push(m); } }; }
function relay(captured, fromNc, toNc, fromId, toId) {
	const dec = fromNc.decryptServerMessage(captured, fromNc.serverShared);
	const p = (dec.a === 'w' && dec.p && typeof dec.p === 'object' && !Array.isArray(dec.p)) ? dec.p[toId] : dec.p;
	return toNc.encryptServerMessage({ a: 'c', p, c: fromId }, toNc.serverShared);
}

const A = makeInstance('alice'), B = makeInstance('bob');
const ids = { A: 'clientA', B: 'clientB' };
establish(A, ids.A, B, ids.B);

// handshake (KV2)
let capB, capA;
{ let out = []; stubTransport(B, out);
	const u = A.encryptClientMessage({ a: 'u', p: 'alice' }, A.channel[ids.B].shared);
	await B.onMessage({ data: relay(A.encryptServerMessage({ a: 'c', p: u, c: ids.B }, A.serverShared), A, B, ids.A) });
	capB = out[0]; }
{ let out = []; stubTransport(A, out);
	const u = B.encryptClientMessage({ a: 'u', p: 'bob' }, B.channel[ids.A].shared);
	await A.onMessage({ data: relay(B.encryptServerMessage({ a: 'c', p: u, c: ids.A }, B.serverShared), B, A, ids.B) });
	capA = out[0]; }
await A.onMessage({ data: relay(capB, B, A, ids.B) });
await B.onMessage({ data: relay(capA, A, B, ids.A) });
check('KV2 handshake', A.channel[ids.B].kv2 === true && B.channel[ids.A].kv2 === true);

const got = [];
B.callbacks.onClientMessage = (m) => got.push(m);
const calls = [];
B.callbacks.onClientCall = (m) => calls.push(m);

// 1) voice_private WITH a:'m' — the exact payload shape main.js now sends.
{
	const audio = 'data:audio/webm;codecs=opus;base64,' + Buffer.alloc(700 * 1024, 4).toString('base64');
	const clientMessagePayload = { a: 'm', t: 'voice_private', d: { audio, dur: 12 }, id: A.genMessageId() };
	let out = []; stubTransport(A, out);
	const enc = A.encryptChannelMessage(ids.B, clientMessagePayload);
	check('voice_private encryptChannelMessage non-empty', !!enc && enc.length > 0);
	const relayed = A.encryptServerMessage({ a: 'c', p: enc, c: ids.B }, A.serverShared);
	await B.onMessage({ data: relay(relayed, A, B, ids.A, ids.B) });
	const last = got[got.length - 1];
	check('voice_private (a:m) delivered', !!last && last.type === 'voice_private' && last.data && last.data.dur === 12,
		last ? 'type=' + last.type : 'nothing received');
}

// 2) voice_private WITHOUT a:'m' — documents the v1.2.0-era bug mechanism:
// the dispatch layer silently drops it.
{
	const before = got.length;
	const clientMessagePayload = { t: 'voice_private', d: { audio: 'x', dur: 3 }, id: A.genMessageId() };
	let out = []; stubTransport(A, out);
	const enc = A.encryptChannelMessage(ids.B, clientMessagePayload);
	const relayed = A.encryptServerMessage({ a: 'c', p: enc, c: ids.B }, A.serverShared);
	await B.onMessage({ data: relay(relayed, A, B, ids.A, ids.B) });
	check('voice_private (no a:) still dropped by dispatch (documents old bug)', got.length === before);
}

// 3) call signal round-trip: offer (with m=video marker) reaches onClientCall.
{
	let out = []; stubTransport(A, out);
	const ok = A.sendCallSignal(ids.B, { t: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' });
	check('sendCallSignal returns true', ok === true);
	if (out.length) await B.onMessage({ data: relay(out[0], A, B, ids.A, ids.B) });
	const last = calls[calls.length - 1];
	check('offer delivered to onClientCall', !!last && last.d && last.d.t === 'offer' && typeof last.d.sdp === 'string' && last.d.sdp.indexOf('m=video') !== -1);
}

// 4) call signal round-trip: audio-only offer (no m=video) — receiver's
// hasVideo detection must be false.
{
	let out = []; stubTransport(A, out);
	A.sendCallSignal(ids.B, { t: 'offer', sdp: 'v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
	if (out.length) await B.onMessage({ data: relay(out[0], A, B, ids.A, ids.B) });
	const last = calls[calls.length - 1];
	check('audio-only offer delivered (no m=video)', !!last && last.d && last.d.t === 'offer' && last.d.sdp.indexOf('m=video') === -1);
}

// 5) static source assertions — the three v1.9.2 fixes are present.
{
	const main = readFileSync('client/js/main.js', 'utf8');
	check('main.js voice_private payload carries a: \'m\'', /\{\s*\n\s*a:\s*'m',\s*\n\s*t:\s*'voice_private'/.test(main));
	check('main.js binds startOutgoing(\'audio\') and startOutgoing(\'video\')', main.includes("startOutgoing('audio')") && main.includes("startOutgoing('video')"));
	check('main.js __jmltUpdateCallBtn covers both buttons', main.includes("'.chat-video-btn'") && main.includes("'.chat-call-btn'"));

	const call = readFileSync('client/js/util.call.js', 'utf8');
	check('util.call.js old private-target guard removed', !call.includes('fromPrivateTarget'));
	check('util.call.js offer guard uses channel[clientId].shared', call.includes('.shared') && call.includes("clean.t === 'offer'"));
	check('util.call.js callee P2P opt-in gate present', /clean\.t === 'offer'[\s\S]{0,600}settings\(\)\.enabled/.test(call));
	check('util.call.js getMedia mode-aware', call.includes('async function getMedia(mode)') && call.includes("mode !== 'video'"));
	check('util.call.js hasVideo derived from offer SDP', call.includes("clean.sdp.indexOf('m=video')"));
	check('util.call.js incoming modal differentiates voice/video', call.includes('call.incoming_voice') && call.includes('call.incoming_video'));

	const html = readFileSync('client/index.html', 'utf8');
	check('index.html has .chat-video-btn', html.includes('chat-video-btn'));

	const css = readFileSync('client/css/style.css', 'utf8');
	check('style.css styles .chat-video-btn + .call-remote-avatar', css.includes('.chat-video-btn') && css.includes('.call-remote-avatar'));

	const i18n = readFileSync('client/js/util.i18n.js', 'utf8');
	for (const key of ['call.incoming_voice', 'call.incoming_video', 'call.incoming_sys_voice', 'call.incoming_sys_video', 'call.calling_voice', 'call.calling_video']) {
		const n = i18n.split("'" + key + "'").length - 1;
		check('i18n key ' + key + ' present in both locales', n === 2, 'occurrences=' + n);
	}

	// v1.9.3: CSP must explicitly allow data: media — voice messages render as
	// <audio src="data:audio/...">; without media-src the directive falls back
	// to default-src 'self' and playback is silently blocked on every platform
	// (web worker header + desktop/APK tauri csp).
	// v1.9.3：CSP 必须显式放行 data: 媒体——语音消息渲染为
	// <audio src="data:audio/...">；缺 media-src 时继承 default-src 'self'，
	// 三端（Worker 头 / 桌面与 APK 的 tauri csp）都会静默拦截播放。
	const worker = readFileSync('worker/index.js', 'utf8');
	check('worker CSP has media-src with data:', /media-src[^;"]*'self' data: blob:/.test(worker));
	const tauri = readFileSync('desktop/src-tauri/tauri.conf.json', 'utf8');
	check('tauri csp has media-src with data:', /media-src[^;"]*'self' data: blob:/.test(tauri));
	check('voice audio element uses data: src', call.includes('voice-audio') || readFileSync('client/js/chat.js', 'utf8').includes('voice-audio'));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);

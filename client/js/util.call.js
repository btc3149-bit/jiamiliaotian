// ==================== v1.5.0 #16: WebRTC 1v1 audio/video calls ====================
// v1.5.0 #16：WebRTC 一对一音视频通话。
//
// SECURITY / RULES.md 对照：
// - 信令走 E2EE 内容层 action 'call'（私有中继 'c' 路径），服务器盲转发。
// - 媒体走 RTCPeerConnection 直连，DTLS-SRTP 浏览器强制加密——不信任额外配置。
// - **IP 互见是 P2P 的本质**：用户已在设置中显式开启「允许 P2P 通话」才会
//   收发通话（默认关）。开关文案明示对方可见你的 IP。
// - 不变量 9：默认 iceServers: []（纯 host candidate，局域网/同网）；STUN
//   仅允许用户自填（parseStunServers 白名单），不内置任何第三方。
// - 零新依赖（浏览器原生 WebRTC），不变量 6 ✓；服务器零改动 ✓。
//
// 诚实边界：NAT 穿透无 TURN 时家庭网络可达率约 60-70%；失败提示
// 「当前网络环境无法直连」，不假装能连。

import { t } from './util.i18n.js';
import { sanitizeCallSignal, parseStunServers } from './util.validate.js';

const RING_TIMEOUT_MS = 30 * 1000;      // unanswered ring gives up / 响铃 30s 超时
const ICE_GATHER_TIMEOUT_MS = 8 * 1000; // don't wait forever for candidates

// Read the user's call settings from local storage. Kept local (no import
// of util.settings) to avoid an import cycle — same pattern as room.js.
// 从本地设置读通话配置。就地读取（不 import util.settings 以防环）——与
// room.js 同款模式。
function readCallSettings() {
	try {
		const s = JSON.parse(localStorage.getItem('settings') || '{}');
		return {
			enabled: s.p2pCalls === true,
			iceServers: parseStunServers(s.stunServers || '').map(u => ({ urls: u }))
		};
	} catch (_e) {
		return { enabled: false, iceServers: [] };
	}
}

function fmtDuration(sec) {
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return m + ':' + String(s).padStart(2, '0');
}

// Create the call manager. Hooks:
//  - getRoom(): () => current room data (roomsData[activeRoomIndex])
//  - addSystem(text, warn): push a system line into the active chat
// The manager renders its own overlay + incoming modal; nothing else to wire.
// 创建通话管理器。钩子：getRoom() 取当前房间；addSystem() 写系统消息。
// 管理器自渲染通话浮层与来电弹窗，其余零接线。
export function createCallManager({ getRoom, addSystem }) {
	let state = 'idle'; // idle | outgoing | incoming | active
	let pc = null;
	let localStream = null;
	let remoteStream = null;
	let pendingOffer = null;   // incoming offer held until accept / 来电 offer 暂存待接
	let peerId = null;
	let peerName = '';
	let ringTimer = null;
	let iceQueue = [];         // candidates arriving before remote description
	let startedAt = 0;
	let durationTimer = null;
	let overlay = null;
	let hasVideo = false; // negotiated media includes video / 协商媒体含视频

	// ---------- helpers ----------
	function send(peer, data) {
		const rd = getRoom();
		if (!rd || !rd.chat || typeof rd.chat.sendCallSignal !== 'function') return false;
		const clean = sanitizeCallSignal(data);
		if (!clean) return false;
		return rd.chat.sendCallSignal(peer, clean);
	}

	function sys(text, warn) {
		try { addSystem(text, !!warn) } catch (_e) { /* best-effort */ }
	}

	function settings() { return readCallSettings(); }

	// ---------- UI ----------
	// v1.9.2: overlay always renders both <video> elements plus an audio-only
	// avatar; applyVideoVisibility() shows/hides per negotiated media and the
	// local stream's tracks.
	// v1.9.2：浮层恒渲染双 <video> 与纯语音头像；applyVideoVisibility() 按
	// 协商结果与本地流轨道做显隐。
	function buildOverlay(mode, name) {
		removeOverlay();
		const ov = document.createElement('div');
		ov.className = 'call-overlay';
		ov.innerHTML = `
			<div class="call-panel">
				<div class="call-remote-avatar">📞</div>
				<video class="call-remote-video" autoplay playsinline></video>
				<video class="call-local-video" autoplay playsinline muted></video>
				<div class="call-info">
					<div class="call-peer">${name.replace(/[<>&]/g, '')}</div>
					<div class="call-status" data-call="status"></div>
				</div>
				<div class="call-controls">
					<button type="button" class="call-ctl call-mute" data-call="mute">🎙</button>
					<button type="button" class="call-ctl call-cam" data-call="cam">📷</button>
					<button type="button" class="call-ctl call-end" data-call="end">📞</button>
				</div>
			</div>
		`;
		document.body.appendChild(ov);
		overlay = ov;
		ov.querySelector('[data-call="end"]').addEventListener('click', () => hangup());
		ov.querySelector('[data-call="mute"]').addEventListener('click', (e) => {
			if (!localStream) return;
			const track = localStream.getAudioTracks()[0];
			if (!track) return;
			track.enabled = !track.enabled;
			e.currentTarget.textContent = track.enabled ? '🎙' : '🔇';
		});
		ov.querySelector('[data-call="cam"]').addEventListener('click', (e) => {
			if (!localStream) return;
			const track = localStream.getVideoTracks()[0];
			if (!track) return;
			track.enabled = !track.enabled;
			e.currentTarget.textContent = track.enabled ? '📷' : '🚫';
		});
		applyVideoVisibility();
		return ov;
	}

	function applyVideoVisibility() {
		if (!overlay) return;
		const ownVid = !!(localStream && localStream.getVideoTracks().length > 0);
		const rv = overlay.querySelector('.call-remote-video');
		const lv = overlay.querySelector('.call-local-video');
		const av = overlay.querySelector('.call-remote-avatar');
		const cam = overlay.querySelector('[data-call="cam"]');
		if (rv) rv.style.display = hasVideo ? '' : 'none';
		if (lv) lv.style.display = ownVid ? '' : 'none';
		if (av) av.style.display = hasVideo ? 'none' : '';
		if (cam) cam.style.display = ownVid ? '' : 'none';
	}

	// v1.9.2: hasVideo selects the icon/text so a voice call never shows the
	// video-call wording.
	// v1.9.2：hasVideo 决定图标与文案，语音来电不再显示视频话术。
	function buildIncomingModal(name, incomingHasVideo) {
		removeIncomingModal();
		const ov = document.createElement('div');
		ov.className = 'call-incoming-overlay';
		ov.innerHTML = `
			<div class="call-incoming-card">
				<div class="call-incoming-icon">${incomingHasVideo ? '🎥' : '📞'}</div>
				<div class="call-peer">${name.replace(/[<>&]/g, '')}</div>
				<div class="call-status">${incomingHasVideo ? t('call.incoming_video', 'Incoming video call…') : t('call.incoming_voice', 'Incoming voice call…')}</div>
				<div class="call-incoming-actions">
					<button type="button" class="call-ctl call-accept" data-call="accept">✅</button>
					<button type="button" class="call-ctl call-end" data-call="decline">❌</button>
				</div>
			</div>
		`;
		document.body.appendChild(ov);
		ov.querySelector('[data-call="accept"]').addEventListener('click', () => accept());
		ov.querySelector('[data-call="decline"]').addEventListener('click', () => {
			send(peerId, { t: 'decline' });
			sys(t('call.declined_by_you', 'You declined the call.'));
			teardown();
		});
		return ov;
	}

	function removeOverlay() {
		if (overlay) { overlay.remove(); overlay = null; }
	}
	function removeIncomingModal() {
		const prev = document.querySelector('.call-incoming-overlay');
		if (prev) prev.remove();
	}

	function setStatus(text) {
		const el = overlay && overlay.querySelector('[data-call="status"]');
		if (el) el.textContent = text;
	}

	function startDurationTimer() {
		startedAt = Date.now();
		clearInterval(durationTimer);
		durationTimer = setInterval(() => {
			setStatus(t('call.active', 'In call') + ' · ' + fmtDuration(Math.floor((Date.now() - startedAt) / 1000)));
		}, 1000);
	}

	// ---------- peer connection ----------
	function createPC() {
		const { iceServers } = settings();
		const conn = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 0 });
		conn.onicecandidate = (e) => {
			if (e.candidate && peerId) {
				send(peerId, { t: 'candidate', candidate: e.candidate.candidate, mid: (e.candidate.sdpMid || '') });
			}
		};
		conn.ontrack = (e) => {
			remoteStream = e.streams[0];
			const v = overlay && overlay.querySelector('.call-remote-video');
			if (v && remoteStream) v.srcObject = remoteStream;
		};
		conn.onconnectionstatechange = () => {
			if (conn.connectionState === 'connected' && state !== 'active') {
				state = 'active';
				clearTimeout(ringTimer); ringTimer = null;
				startDurationTimer();
			} else if (conn.connectionState === 'failed') {
				sys(t('call.failed', 'Call failed — the network cannot establish a direct connection (no TURN server; P2P reachability is best-effort).'), true);
				teardown();
			} else if (conn.connectionState === 'disconnected' || conn.connectionState === 'closed') {
				if (state === 'active') {
					sys(t('call.ended', 'Call ended.'));
					teardown();
				}
			}
		};
		return conn;
	}

	// v1.9.2: mode-aware media acquisition — 'audio' never asks for a camera.
	// v1.9.2：按模式取流——'audio' 完全不请求摄像头。
	async function getMedia(mode) {
		if (mode !== 'video') {
			return await navigator.mediaDevices.getUserMedia({ audio: true });
		}
		try {
			return await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
		} catch (_e) {
			// camera refused → audio-only fallback / 摄像头被拒 → 纯语音降级
			return await navigator.mediaDevices.getUserMedia({ audio: true });
		}
	}

	function attachLocal() {
		const v = overlay && overlay.querySelector('.call-local-video');
		if (v && localStream) v.srcObject = localStream;
	}

	// ---------- outgoing ----------
	// v1.9.2: mode is 'audio' | 'video' (legacy callers without a mode keep
	// the previous video behaviour).
	// v1.9.2：mode 为 'audio' | 'video'（不带参数的旧调用保持原视频行为）。
	async function startOutgoing(mode) {
		const isVideo = mode === 'video';
		const { enabled } = settings();
		if (!enabled) {
			sys(t('call.disabled', 'P2P calls are disabled. Enable them in Settings (the peer will see your IP — that is the nature of direct connections).'), true);
			return;
		}
		if (state !== 'idle') {
			sys(t('call.busy', 'A call is already in progress.'), true);
			return;
		}
		const rd = getRoom();
		if (!rd || !rd.privateChatTargetId || !rd.chat) {
			sys(t('call.need_private', 'Select a private-chat partner first — calls are 1-to-1.'), true);
			return;
		}
		const targetClient = rd.chat.channel[rd.privateChatTargetId];
		if (!targetClient || !targetClient.shared) {
			sys(t('system.user_not_connected', 'User might not be fully connected.'), true);
			return;
		}
		peerId = rd.privateChatTargetId;
		peerName = rd.privateChatTargetName || peerId;
		state = 'outgoing';
		hasVideo = isVideo; // provisional; corrected after getMedia / 预置值，取流后校正
		buildOverlay('outgoing', peerName);
		setStatus(t('call.ringing', 'Ringing…'));
		sys(t(isVideo ? 'call.calling_video' : 'call.calling_voice', isVideo ? 'Calling {name} (video)…' : 'Calling {name} (voice)…').replace('{name}', peerName));
		try {
			localStream = await getMedia(isVideo ? 'video' : 'audio');
			hasVideo = localStream.getVideoTracks().length > 0;
			applyVideoVisibility();
			attachLocal();
			pc = createPC();
			for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			if (!send(peerId, { t: 'offer', sdp: pc.localDescription.sdp })) {
				sys(t('call.signal_failed', 'Could not deliver the call signal — is the peer still connected?'), true);
				teardown();
				return;
			}
			// ring timeout: peer never answered / 响铃超时：对方一直没接
			ringTimer = setTimeout(() => {
				if (state === 'outgoing') {
					send(peerId, { t: 'hangup' });
					sys(t('call.no_answer', 'No answer (30 s).'));
					teardown();
				}
			}, RING_TIMEOUT_MS);
		} catch (_e) {
			sys(t('call.media_failed', 'Could not access microphone/camera — call cancelled.'), true);
			teardown();
		}
	}

	// ---------- incoming ----------
	async function accept() {
		removeIncomingModal();
		if (state !== 'incoming' || !pendingOffer) return;
		const name = peerName;
		try {
			buildOverlay('active', name);
			setStatus(t('call.connecting', 'Connecting…'));
			// hasVideo was derived from the offer SDP — match the caller's
			// media exactly (video offer → try video, graceful audio fallback).
			// hasVideo 由 offer SDP 推得——与呼叫方媒体精确匹配（视频 offer
			// 才请求摄像头，失败自动降级纯语音）。
			localStream = await getMedia(hasVideo ? 'video' : 'audio');
			applyVideoVisibility();
			attachLocal();
			pc = createPC();
			for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
			await pc.setRemoteDescription({ type: 'offer', sdp: pendingOffer.sdp });
			pendingOffer = null;
			await flushIceQueue();
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			if (!send(peerId, { t: 'answer', sdp: pc.localDescription.sdp })) {
				sys(t('call.signal_failed', 'Could not deliver the call signal — is the peer still connected?'), true);
				teardown();
				return;
			}
			clearTimeout(ringTimer); ringTimer = null;
			// state flips to 'active' on pc connected / 连接建立后转 active
		} catch (_e) {
			sys(t('call.media_failed', 'Could not access microphone/camera — call cancelled.'), true);
			send(peerId, { t: 'decline' });
			teardown();
		}
	}

	// ---------- signal routing ----------
	async function handleSignal(msg) {
		if (!msg || !msg.clientId) return;
		const rd = getRoom();
		const clean = sanitizeCallSignal(msg.d);
		if (!clean) return; // malformed → drop silently / 非法载荷静默丢弃
		// v1.9.2: any fully-handshaked room member may call — the incoming
		// popup IS the consent gate. The old "must be the current private-chat
		// target" guard silently declined calls whenever the callee had not
		// opened that exact private chat, which made calls flaky ("sometimes
		// the peer never sees the incoming screen"). Non-offer signals still
		// only count from the established call peer below.
		// v1.9.2：房间内任意已完成握手的成员均可来电——来电弹窗本身就是同意
		// 门槛。旧守卫要求「必须是当前私聊对象」，对方没打开对应私聊就被静默
		// 拒接，表现为「时通时不通/收不到来电」。非 offer 信令仍只认已建立的
		// 通话对端。
		if (clean.t === 'offer') {
			const sender = rd && rd.chat && rd.chat.channel && rd.chat.channel[msg.clientId];
			if (!sender || !sender.shared) {
				send(msg.clientId, { t: 'decline' });
				return;
			}
			// the callee's own P2P opt-in still gates incoming calls
			// 接收方自己的 P2P 开关仍是来电门槛
			if (!settings().enabled) {
				send(msg.clientId, { t: 'decline' });
				return;
			}
			if (state !== 'idle') {
				// busy: auto-decline, never stack calls / 忙线自动拒接，不叠通话
				send(msg.clientId, { t: 'decline' });
				sys(t('call.missed_busy', 'Missed call from {name} (busy).').replace('{name}', peerName || msg.clientId));
				return;
			}
			peerId = msg.clientId;
			peerName = (rd.userMap[msg.clientId] && (rd.userMap[msg.clientId].userName || rd.userMap[msg.clientId].username)) || msg.clientId;
			// media type comes from the offer SDP itself — no extra wire field
			// 媒体类型直接从 offer SDP 判定——不新增线上字段
			hasVideo = typeof clean.sdp === 'string' && clean.sdp.indexOf('m=video') !== -1;
			state = 'incoming';
			pendingOffer = clean;
			buildIncomingModal(peerName, hasVideo);
			sys(t(hasVideo ? 'call.incoming_sys_video' : 'call.incoming_sys_voice', hasVideo ? '🎥 Video call from {name}.' : '📞 Voice call from {name}.').replace('{name}', peerName));
			// auto-decline after the ring timeout / 响铃超时自动拒接
			ringTimer = setTimeout(() => {
				if (state === 'incoming') {
					send(peerId, { t: 'decline' });
					sys(t('call.missed', 'Missed call from {name}.').replace('{name}', peerName));
					teardown();
				}
			}, RING_TIMEOUT_MS);
			return;
		}
		if (msg.clientId !== peerId) return; // signals only from the call peer / 只认通话对端的信令
		if (clean.t === 'answer' && state === 'outgoing' && pc) {
			try {
				await pc.setRemoteDescription({ type: 'answer', sdp: clean.sdp });
				await flushIceQueue();
				clearTimeout(ringTimer); ringTimer = null;
			} catch (_e) {
				sys(t('call.failed', 'Call failed — the network cannot establish a direct connection (no TURN server; P2P reachability is best-effort).'), true);
				teardown();
			}
		} else if (clean.t === 'candidate' && pc) {
			const cand = { candidate: clean.candidate, sdpMid: clean.mid || undefined };
			if (pc.remoteDescription && pc.remoteDescription.type) {
				try { await pc.addIceCandidate(cand); } catch (_e) { /* stale candidate is normal */ }
			} else {
				iceQueue.push(cand); // arrived early — buffer / 早到先缓冲
			}
		} else if (clean.t === 'hangup') {
			sys(state === 'active'
				? t('call.ended', 'Call ended.')
				: t('call.cancelled', 'Call cancelled by the peer.'));
			teardown();
		} else if (clean.t === 'decline') {
			sys(t('call.declined_by_peer', 'Call declined by {name}.').replace('{name}', peerName));
			teardown();
		}
	}

	async function flushIceQueue() {
		const q = iceQueue; iceQueue = [];
		for (const cand of q) {
			try { await pc.addIceCandidate(cand); } catch (_e) { /* stale is fine */ }
		}
	}

	// ---------- teardown ----------
	function hangup() {
		if (peerId) send(peerId, { t: 'hangup' });
		if (state === 'active') {
			sys(t('call.ended_duration', 'Call ended · {d}.').replace('{d}', fmtDuration(Math.floor((Date.now() - startedAt) / 1000))));
		} else {
			sys(t('call.cancelled_by_you', 'Call cancelled.'));
		}
		teardown();
	}

	function teardown() {
		clearTimeout(ringTimer); ringTimer = null;
		clearInterval(durationTimer); durationTimer = null;
		if (pc) { try { pc.close(); } catch (_e) { /* ignore */ } pc = null; }
		if (localStream) {
			for (const track of localStream.getTracks()) { try { track.stop(); } catch (_e) { /* ignore */ } }
			localStream = null;
		}
		remoteStream = null;
		pendingOffer = null;
		hasVideo = false;
		iceQueue = [];
		peerId = null;
		peerName = '';
		state = 'idle';
		removeOverlay();
		removeIncomingModal();
	}

	// The call peer left the room — the session is dead regardless of PC state.
	// 通话对端离开房间——无论连接状态如何会话已死。
	function handlePeerLeft(clientId) {
		if (peerId && clientId === peerId && state !== 'idle') {
			sys(t('call.ended', 'Call ended.'));
			teardown();
		}
	}

	return {
		startOutgoing,
		handleSignal,
		handlePeerLeft,
		hangup,
		get state() { return state; }
	};
}

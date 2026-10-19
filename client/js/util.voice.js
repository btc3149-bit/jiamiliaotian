// v1.1.0 → v1.2.0 #9: voice messages via MediaRecorder.
// SECURITY / RULES.md 对照：
// - 音频在本机录制 → dataURL → 与图片同路走 E2EE 内容层（sendChannelMessage /
//   私聊加密信封），worker 仍盲转发（不变量 9 / 1）
// - 不落盘、不存 IndexedDB：录音仅在内存 blob 中转，发送后即弃
// - 上限 60s：MediaRecorder 自动停止，防止把 ws 单帧撑爆（与图片 dataURL 同约束）

export const MAX_VOICE_MS = 60 * 1000;
export const VOICE_PREFIX = 'voice';

// Pure helpers (unit-testable in Node — no DOM needed).
// 纯函数（可在 Node 单测，无 DOM 依赖）。
export function formatVoiceDuration(ms) {
	const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return m + ':' + String(r).padStart(2, '0')
}

export function isVoiceMsgType(msgType) {
	return msgType === 'voice' || msgType === 'voice_private'
}

// Validate a voice payload before rendering: dataUrl must be an audio data
// URL, duration a sane finite number. Returns null when invalid.
// 渲染前校验语音载荷：dataUrl 必须是 audio data URL，时长必须是有限数。
export function sanitizeVoicePayload(data) {
	if (!data || typeof data !== 'object') return null;
	const audio = typeof data.audio === 'string' ? data.audio : '';
	if (audio.indexOf('data:audio/') !== 0) return null;
	if (audio.length > 2 * 1024 * 1024) return null; // 60s opus ≈ 240KB; hard cap 2MB
	let dur = Number(data.dur);
	if (!Number.isFinite(dur) || dur < 0) dur = 0;
	if (dur > 120) dur = 120;
	return { audio, dur: Math.round(dur) }
}

function pickMime() {
	const candidates = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/ogg;codecs=opus',
		'audio/mp4'
	];
	if (typeof MediaRecorder === 'undefined') return '';
	for (const c of candidates) {
		try {
			if (MediaRecorder.isTypeSupported(c)) return c
		} catch (_e) { /* keep trying */ }
	}
	return ''
}

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(new Error('read failed'));
		reader.readAsDataURL(blob)
	})
}

// Recorder state machine: click → start, click → stop & deliver, Esc → cancel.
// Internal single-recorder guard; UI feedback via callback `onState`.
// 录音状态机：单击开始，再击停止并发送，Esc 取消。UI 状态经 onState 回调反馈。
export function createVoiceRecorder({ onState, onVoice, onError } = {}) {
	let recorder = null;
	let stream = null;
	let chunks = [];
	let startedAt = 0;
	let timer = null;
	let state = 'idle'; // idle | recording

	function setState(next) {
		state = next;
		if (typeof onState === 'function') onState(next)
	}

	function cleanup() {
		if (timer) { clearTimeout(timer); timer = null }
		if (stream) {
			try { stream.getTracks().forEach((tr) => tr.stop()) } catch (_e) { /* best-effort */ }
			stream = null
		}
		chunks = [];
		recorder = null;
		setState('idle')
	}

	async function toggle() {
		if (state === 'recording') {
			try { recorder.stop() } catch (_e) { cleanup(); }
			return
		}
		if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			if (typeof onError === 'function') onError('unsupported');
			return
		}
		let mimeType = pickMime();
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		} catch (_e) {
			if (typeof onError === 'function') onError('permission');
			return
		}
		try {
			recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
		} catch (_e) {
			try { recorder = new MediaRecorder(stream) } catch (_e2) {
				cleanup();
				if (typeof onError === 'function') onError('unsupported');
				return
			}
		}
		chunks = [];
		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size) chunks.push(e.data)
		};
		recorder.onstop = async () => {
			const durMs = Date.now() - startedAt;
			const blob = new Blob(chunks, { type: recorder && recorder.mimeType ? recorder.mimeType : 'audio/webm' });
			cleanup();
			if (durMs < 500) return; // accidental tap — discard / 误触丢弃
			try {
				const audio = await blobToDataUrl(blob);
				if (typeof onVoice === 'function') onVoice(Math.round(durMs / 1000), audio)
			} catch (_e) {
				if (typeof onError === 'function') onError('encode')
			}
		};
		startedAt = Date.now();
		recorder.start();
		setState('recording');
		timer = setTimeout(() => {
			// hard cap: auto stop & send at MAX_VOICE_MS / 上限到点自动停止并发送
			try { recorder.stop() } catch (_e) { cleanup(); }
		}, MAX_VOICE_MS)
	}

	function cancel() {
		if (state !== 'recording') return;
		recorder.onstop = null; // discard / 丢弃
		try { recorder.stop() } catch (_e) { /* ignore */ }
		cleanup()
	}

	return {
		toggle,
		cancel,
		get state() { return state }
	}
}

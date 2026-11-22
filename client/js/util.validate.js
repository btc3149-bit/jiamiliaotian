// ==================== Protocol validation helpers (review R5) ====================
// 纯协议校验辅助函数（评审 R5）。SECURITY：
// - 全部为纯函数、零 DOM 依赖，可在 Node 中直接单测（test-protocol.mjs）
// - 消息 id 白名单、重播条目消毒、水位筛选、去重 —— 协议层信任边界的唯一实现点
// - room.js 的 sync/rs 处理与 NodeCrypt 的发送端消毒共用这里的规则

// ==================== #30: sync replay suppression ====================
// Before this, every online peer answered a reconnect 'sync' request
// immediately — N peers meant N duplicate replay batches (receiver dedupes
// by id, but the CPU/bandwidth was already spent). Responders now wait a
// random delay; the requester broadcasts 'sd' (sync-done) once it has a
// batch, and pending responders suppress theirs. A sole holder is never
// suppressed to death: suppression ONLY happens on an explicit 'sd' from
// the requester, and the requester re-asks once if nobody answered.
// #30：sync 重播抑制。此前每个在线同伴都立即应答重连 'sync'——N 个
// 同伴 = N 份重复重播（接收端按 id 去重，但 CPU/带宽已花）。现在应答
// 方先随机延迟；请求方收到批次后广播 'sd'，待应答者据此抑制自己的
// 应答。唯一持有者不会被抑制死：抑制只发生在请求方显式 'sd' 时，且
// 请求方无人应答时会兜底再请求一次。

// Random responder delay: 250ms + rand×1500ms ∈ [250, 1750) ms — wide
// enough that one responder almost always wins and announces 'sd' first,
// short enough that reconnect backfill still feels instant.
// 应答随机延迟：250 + rand×1500 ∈ [250, 1750) ms——足够宽到几乎总有
// 一个应答者先赢并发出 'sd'，又足够短不影响重连补拉体感。
export function syncReplyDelayMs(rand = Math.random()) {
	const r = (typeof rand === 'number' && rand >= 0 && rand < 1) ? rand : 0;
	return 250 + Math.floor(r * 1500);
}

// Pure suppression gate, keyed by requester clientId. Timers live in the
// caller (room.js); this class only tracks pending/suppressed state so the
// decision logic is unit-testable without a DOM or clock.
// 纯抑制门，按请求方 clientId 分键。定时器在调用方（room.js），本类只
// 跟踪待应答/已抑制状态，使决策逻辑可无 DOM/时钟单测。
export class SyncReplyGate {
	constructor() {
		this.pending = new Set();
		this.suppressed = new Set();
	}
	// Register a pending reply; returns false if this requester is already
	// suppressed (a previous 'sd' covers this sync episode).
	noteRequest(clientId) {
		if (!clientId) return false;
		if (this.suppressed.has(clientId)) return false;
		this.pending.add(clientId);
		return true;
	}
	// The requester announced sync-done: suppress any pending reply to it.
	// Returns true when a pending reply was actually suppressed.
	noteSyncDone(clientId) {
		if (!clientId) return false;
		this.suppressed.add(clientId);
		return this.pending.delete(clientId);
	}
	// Should a due (delay elapsed) reply to this requester be sent?
	shouldSend(clientId) {
		return this.pending.has(clientId) && !this.suppressed.has(clientId);
	}
	// The reply went out (or the requester left): clear pending state.
	noteSettled(clientId) {
		this.pending.delete(clientId);
	}
	// A fresh sync episode for this requester (new request after the
	// previous episode settled) clears the suppression flag.
	resetEpisode(clientId) {
		this.suppressed.delete(clientId);
		this.pending.delete(clientId);
	}
}

// Message id whitelist: 8-32 alphanumeric chars (matches genMessageId output).
// 消息 id 白名单：8-32 位字母数字。
export function isValidMid(id) {
	return typeof id === 'string' && /^[A-Za-z0-9]{8,32}$/.test(id)
}

// Reaction emoji validation (item 20): a reaction must be EXACTLY ONE
// grapheme cluster — a ZWJ sequence (e.g. family emoji), a flag pair, or a
// base + skin-tone / variation-selector sequence all count as one — within
// a hard length cap. Anything else (plain text, multiple emoji, whitespace,
// markup) is rejected. Senders validate before sending; receivers
// re-validate before touching state/DOM (RULES.md invariant 5 posture).
// 回应 emoji 校验：必须恰好是一个 grapheme 簇（ZWJ 序列、国旗、肤色/变体
// 选择符序列均算一个），且有硬长度上限；纯文本、多 emoji、空白、标记一律拒绝。
export const REACTION_EMOJI_MAX_LENGTH = 32; // UTF-16 code units
export function countGraphemes(s) {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		let n = 0;
		for (const _part of seg.segment(s)) { n++; if (n > 1) break }
		return n
	}
	// Fallback (no Intl.Segmenter): count code points, treating ZWJ-joined
	// sequences, variation selectors, skin-tone modifiers and regional
	// indicator pairs as part of the preceding grapheme.
	const cps = Array.from(s);
	let n = 0;
	for (let i = 0; i < cps.length; i++) {
		const cp = cps[i].codePointAt(0);
		if (cp === 0x200D) { // ZWJ joins the next code point into this grapheme
			i++;
			continue
		}
		if (cp === 0xFE0E || cp === 0xFE0F) continue; // variation selectors
		if (cp >= 0x1F3FB && cp <= 0x1F3FF) continue; // skin tones
		if (cp >= 0xE0020 && cp <= 0xE007F) continue; // tag characters (subdivision flags)
		if (cp >= 0x1F1E6 && cp <= 0x1F1FF && i + 1 < cps.length) { // flag pair
			const next = cps[i + 1].codePointAt(0);
			if (next >= 0x1F1E6 && next <= 0x1F1FF) { n++; i++; continue }
		}
		n++
	}
	return n
}
export function isValidReactionEmoji(e) {
	if (typeof e !== 'string' || e.length === 0 || e.length > REACTION_EMOJI_MAX_LENGTH) return false;
	if (/\s/.test(e)) return false;
	if (!/\p{Emoji}/u.test(e)) return false; // must actually be emoji-ish, not a lone letter/digit
	return countGraphemes(e) === 1
}

// Sanitize one wire-format replay entry (from the 'rs' action). Returns a
// clean entry, or null when the entry must be dropped.
// 消毒单条重播条目（'rs' action 载荷），不合法返回 null。
export function sanitizeReplayEntry(e) {
	if (!e || typeof e !== 'object') return null;
	if (!isValidMid(e.id)) return null;
	if ((e.t !== 'text' && e.t !== 'image') || typeof e.d !== 'string' || e.d.length === 0) return null;
	if (e.t === 'text' && e.d.length > 10000) return null;
	if (e.t === 'image' && e.d.length > 300000) return null;
	// future timestamps beyond +60s clock skew are clamped to 0 (caller
	// substitutes Date.now()); rejects obviously forged dates.
	const ts = (typeof e.ts === 'number' && e.ts > 0 && e.ts < Date.now() + 60000) ? Math.floor(e.ts) : 0;
	return {
		id: e.id,
		t: e.t,
		d: e.d,
		ts,
		u: (typeof e.u === 'string') ? e.u.slice(0, 64) : '',
		self: e.self === true,
		m: Array.isArray(e.m) ? e.m.filter(isValidMid).slice(0, 20) : [],
		q: (e.q && typeof e.q.x === 'string' && e.q.x.length <= 300)
			? { u: (typeof e.q.u === 'string') ? e.q.u.slice(0, 64) : '', x: e.q.x }
			: null,
		ttl: (e.ttl === 30 || e.ttl === 300 || e.ttl === 3600) ? e.ttl : null
	}
}

// Dedupe + sanitize a replay batch against already-known ids, capped entries.
// 对重播批次去重 + 消毒（对照已知 id 集合），上限 cap 条。
export function dedupeReplayBatch(msgs, existingIds, cap = 50) {
	const existing = existingIds instanceof Set ? existingIds : new Set();
	const out = [];
	if (!Array.isArray(msgs)) return out;
	for (const e of msgs) {
		if (out.length >= cap) break;
		const s = sanitizeReplayEntry(e);
		if (!s || existing.has(s.id)) continue;
		existing.add(s.id);
		out.push(s);
	}
	return out;
}

// Select replayable entries from a room's in-memory message buffer to answer
// a sync request: skip known ids, skip system/recalled/burned/non-text types,
// only entries strictly newer than the watermark `since`. Output is the
// wire-format (already sanitized) batch.
// 从房间内存消息缓冲中筛出可重播条目以应答 sync 请求（水位之后、未知 id、
// 未撤回未焚毁、仅 text/image）。输出为已消毒的线格式批次。
export function selectReplayable(messages, since, knownIds, myUserName = '', cap = 50) {
	const known = knownIds instanceof Set ? knownIds : new Set();
	const out = [];
	if (!Array.isArray(messages)) return out;
	for (const m of messages) {
		if (out.length >= cap) break;
		if (!m || !m.id || known.has(m.id)) continue;
		if (m.type === 'system' || m.burned || m.deleted) continue;
		if (typeof m.timestamp !== 'number' || m.timestamp <= since) continue;
		const mt = (m.msgType === 'image' || m.msgType === 'image_private') ? 'image' : (m.msgType === 'text' ? 'text' : null);
		if (!mt) continue; // file transfers / unknown types cannot be replayed
		if (typeof m.text !== 'string' || m.text.length === 0) continue;
		const entry = sanitizeReplayEntry({
			id: m.id,
			t: mt,
			d: m.text,
			ts: m.timestamp,
			u: m.type === 'me' ? myUserName : (m.userName || ''),
			self: m.type === 'me',
			m: Array.isArray(m.mentions) ? m.mentions.slice(0, 20) : [],
			q: m.quote || null,
			ttl: m.ttl || null
		});
		if (entry) out.push(entry);
	}
	return out;
}

// Filter a list down to valid message ids (read-receipt whitelist shares the
// same id rule). 已读回执白名单：与消息 id 同规则过滤。
export function filterValidMids(ids, cap = 50) {
	if (!Array.isArray(ids)) return [];
	return ids.filter(isValidMid).slice(0, cap)
}

// v1.2.0 #17: validate a file-resume request before acting on it. fileId must
// be transfer-id safe, indices deduped/sorted/in-range, count capped. Returns
// null when the request is malformed.
// v1.2.0 #17：校验断点续传请求。fileId 必须是安全的传输 id，分卷下标去重/
// 排序/在界内，数量封顶。非法返回 null。
export function sanitizeResumeRequest(fileId, missing, totalVolumes, cap = 512) {
	if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(fileId)) return null;
	const total = Number(totalVolumes);
	if (!Number.isInteger(total) || total < 1 || total > 100000) return null;
	if (!Array.isArray(missing) || missing.length === 0) return null;
	const seen = new Set();
	for (const v of missing) {
		const n = Number(v);
		if (!Number.isInteger(n) || n < 0 || n >= total) return null;
		seen.add(n);
		if (seen.size > cap) return null;
	}
	return { fileId, missing: Array.from(seen).sort((a, b) => a - b) }
}

// v1.2.0 #9: shared validation for resume-side volume payload messages.
// v1.2.0 #9：续传分卷载荷与 file_volume 同构，这里只做白名单判断。
export function isValidFileVolumeMessage(msg) {
	return !!(msg && typeof msg === 'object' &&
		typeof msg.fileId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(msg.fileId) &&
		Number.isInteger(msg.volumeIndex) && msg.volumeIndex >= 0 &&
		typeof msg.volumeData === 'string' && msg.volumeData.length > 0 &&
		msg.volumeData.length <= 1024 * 1024)
}

// v1.4.0 #12: presence status whitelist ('st' action). The only three states
// a member may declare; anything else is dropped at both send and receive.
// v1.4.0 #12：在线状态白名单（'st' action）。成员只能声明这三种状态，
// 发送端与接收端共用这一条边界，其余一律丢弃。
export function sanitizePresenceStatus(s) {
	return (s === 'online' || s === 'away' || s === 'busy') ? s : null
}

// v1.5.0 #16: WebRTC call-signal sanitizer ('call' action). The payload is
// SDP/ICE relayed peer-to-peer inside the E2EE envelope; the server stays
// blind. Types are whitelisted, SDP is size-capped and control-char-free,
// ICE candidate strings are short. Returns a clean object or null.
// v1.5.0 #16：WebRTC 通话信号消毒（'call' action）。载荷是 E2EE 信封内
// 点对点中继的 SDP/ICE，服务器全盲。类型白名单、SDP 限长且无控制字符、
// ICE 候选短串。合法返回干净对象，否则 null。
export function sanitizeCallSignal(d) {
	if (!d || typeof d !== 'object') return null;
	const t = d.t;
	if (t !== 'offer' && t !== 'answer' && t !== 'candidate' && t !== 'hangup' && t !== 'decline') return null;
	const out = { t };
	if (t === 'offer' || t === 'answer') {
		if (typeof d.sdp !== 'string' || !d.sdp || d.sdp.length > 32768) return null;
		// reject control characters except \r\n inside SDP text
		// SDP 文本中除 \r\n 外的控制字符一律拒绝
		if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(d.sdp)) return null;
		out.sdp = d.sdp;
	} else if (t === 'candidate') {
		if (typeof d.candidate !== 'string' || !d.candidate || d.candidate.length > 2048) return null;
		out.candidate = d.candidate;
		out.mid = (typeof d.mid === 'string' && d.mid.length <= 128) ? d.mid : '';
	}
	return out;
}

// v1.5.0 #16: parse user-supplied STUN server list. Only stun: URLs with a
// safe host charset and optional port; no turn: (needs credentials — out of
// scope), no third-party defaults (RULES.md invariant 9: nothing built in).
// v1.5.0 #16：解析用户自填的 STUN 服务器列表。只收 stun: URL（安全主机字符
// 集 + 可选端口）；不收 turn:（需要凭据，不在范围内），不内置任何第三方
// （RULES.md 不变量 9：不默认内置）。
export function parseStunServers(input, cap = 4) {
	if (typeof input !== 'string') return [];
	const out = [];
	for (const raw of input.split(/[\s,]+/)) {
		if (!raw) continue;
		const m = /^stun:([A-Za-z0-9.\-_]+)(?::(\d{1,5}))?$/.exec(raw);
		if (!m) continue;
		if (m[2] && (+m[2] < 1 || +m[2] > 65535)) continue;
		const url = m[2] ? 'stun:' + m[1] + ':' + (+m[2]) : 'stun:' + m[1];
		if (out.indexOf(url) === -1) out.push(url);
		if (out.length >= cap) break;
	}
	return out;
}

// v1.8.0 #20: sanitize a build-time baked default server URL (injected via
// vite define / JMLT_DEFAULT_SERVER). Strict: https ONLY (release builds
// ship this to end users), origin only (no path/query/hash/userinfo),
// credentials rejected. Anything questionable → '' (same-origin fallback).
// This is a convenience default, never a trust decision: the E2EE channel
// fingerprint verification still applies on top.
// v1.8.0 #20：消毒构建期烤入的默认服务器地址（vite define /
// JMLT_DEFAULT_SERVER 注入）。严格：仅 https（发布构建会把它带给最终用户）、
// 仅 origin（不带路径/查询/哈希/用户信息）、拒绝凭据。任何可疑输入 → ''
// （回退同源）。这只是便利性默认值，不是信任决策：E2EE 通道指纹校验依然在其上生效。
export function sanitizeBakedServerUrl(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return '';
	try {
		const u = new URL(raw.trim());
		if (u.protocol !== 'https:' || !u.hostname) return '';
		if (u.username || u.password || u.search || u.hash) return '';
		if (u.pathname && u.pathname !== '/') return '';
		return u.origin;
	} catch (_e) {
		return '';
	}
}

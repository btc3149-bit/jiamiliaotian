// ==================== Protocol validation helpers (review R5) ====================
// 纯协议校验辅助函数（评审 R5）。SECURITY：
// - 全部为纯函数、零 DOM 依赖，可在 Node 中直接单测（test-protocol.mjs）
// - 消息 id 白名单、重播条目消毒、水位筛选、去重 —— 协议层信任边界的唯一实现点
// - room.js 的 sync/rs 处理与 NodeCrypt 的发送端消毒共用这里的规则

// Message id whitelist: 8-32 alphanumeric chars (matches genMessageId output).
// 消息 id 白名单：8-32 位字母数字。
export function isValidMid(id) {
	return typeof id === 'string' && /^[A-Za-z0-9]{8,32}$/.test(id)
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

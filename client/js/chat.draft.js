// ==================== Per-room local drafts (split from chat.js, item 48) ====================
// 草稿簇：从 chat.js 拆出。存储位置与格式一字未动（不变量 4 边界）：
// 仍是 sessionStorage、key 仍是 'jmlt_draft:' + 频道哈希。
// chat.js keeps the original export names as a forwarding layer.

// ==================== P2: per-room local drafts ====================
// 本地草稿。SECURITY/RULES.md 对照：
// - 只存用户自己输入的消息文本，绝不存密码/密钥素材（不变量 4）
// - 用 sessionStorage：作用域仅当前标签页会话，关标签即焚
// - key 用频道哈希（sha256 hex，客户端自算），房间名不上存储
function draftKey(channelHash) {
	const safe = String(channelHash || '');
	return /^[0-9a-f]{64}$/.test(safe) ? 'jmlt_draft:' + safe : null
}

function isBlankHtml(html) {
	return !html || html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, '').replace(/\u200B/g, '').trim() === ''
}

export function saveDraft(channelHash, html) {
	const key = draftKey(channelHash);
	if (!key) return;
	try {
		if (isBlankHtml(html)) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, html)
	} catch (error) { /* storage unavailable — draft is best-effort */ }
}

export function loadDraft(channelHash) {
	const key = draftKey(channelHash);
	if (!key) return '';
	try {
		return sessionStorage.getItem(key) || ''
	} catch (error) {
		return ''
	}
}

export function clearDraft(channelHash) {
	const key = draftKey(channelHash);
	if (!key) return;
	try {
		sessionStorage.removeItem(key)
	} catch (error) { /* noop */ }
}

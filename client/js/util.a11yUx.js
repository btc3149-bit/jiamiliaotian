// Accessibility + product-UX helpers (items 41/42/43/45/47).
// 无障碍与产品体验辅助模块。纯逻辑部分（提及候选、跨房搜索、已读聚合、
// 密码强度、快捷键分类、焦点陷阱索引）零 DOM 依赖，可被 Node 测试直接 import；
// DOM 部分只有 live region 播报与弹窗焦点管理。
//
// RULES.md 对照：全部纯本地——提及候选只读当前房间内存 userMap；跨房搜索只扫
// 本设备内存中已加载房间（含本地加密历史解密后合并进缓冲的消息）；已读名单只在
// 作者本机由既有 E2EE 回执聚合，不新增任何服务端状态；密码生成用 WebCrypto
// 本地随机源，密码不落盘、不外送。

// ---------- 42: @mention autocomplete ----------

// Extract the in-progress @token immediately before the caret.
// textBeforeCaret: plain text of the composer up to the caret.
// Returns { query, start } or null. A token starts at an '@' that is at the
// start of the text or preceded by whitespace, and contains no whitespace.
export function getMentionQuery(textBeforeCaret) {
	if (typeof textBeforeCaret !== 'string' || !textBeforeCaret) return null;
	const m = /(?:^|\s)@([^\s@]{0,32})$/.exec(textBeforeCaret);
	if (!m) return null;
	return { query: m[1], start: textBeforeCaret.length - m[1].length - 1 };
}

// Filter room members for the mention popup. Prefix matches rank first,
// then substring matches; case-insensitive. Excludes the given clientId
// (usually oneself). Purely local: userMap is the current room's member map.
export function filterMentionCandidates(userMap, query, excludeId = null, limit = 8) {
	if (!userMap || typeof userMap !== 'object') return [];
	const q = String(query || '').toLowerCase();
	const out = [];
	for (const cid in userMap) {
		if (excludeId && cid === excludeId) continue;
		const u = userMap[cid];
		const name = u ? (u.userName || u.username || u.name || '') : '';
		if (!name) continue;
		const lower = name.toLowerCase();
		let rank = -1;
		if (q === '') rank = 0;
		else if (lower.startsWith(q)) rank = 0;
		else if (lower.includes(q)) rank = 1;
		if (rank === -1) continue;
		out.push({ clientId: cid, name, rank });
	}
	out.sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
	return out.slice(0, Math.max(1, limit || 8)).map(({ clientId, name }) => ({ clientId, name }));
}

// ---------- 42: read receipts — who read it ----------

// Record one reader on an own-message entry. entry.readBy is a local-only
// clientId list; entry.read mirrors "at least one reader" for the old chip.
export function recordReader(entry, clientId) {
	if (!entry || !clientId || typeof clientId !== 'string') return false;
	if (!Array.isArray(entry.readBy)) entry.readBy = entry.read ? [] : [];
	if (entry.readBy.indexOf(clientId) !== -1) return false;
	entry.readBy.push(clientId);
	entry.read = true;
	return true;
}

// Resolve reader clientIds to display names via a room userMap.
export function readerNames(entry, userMap, fallbackName) {
	if (!entry || !Array.isArray(entry.readBy)) return [];
	return entry.readBy.map(cid => {
		const u = userMap && userMap[cid];
		return (u && (u.userName || u.username || u.name)) || fallbackName || cid;
	});
}

// ---------- 45: cross-room local search ----------

function baseMsgType(m) {
	const t = (m && (m.msgType || m.type)) || '';
	return String(t).replace(/_private$/, '');
}
function senderOf(m, room) {
	if (!m) return '';
	if (m.type === 'me') return (room && (room.myUserName || '')) || '';
	return m.userName || '';
}
function searchableText(m) {
	if (!m || typeof m.text !== 'string') return null;
	if (m.type === 'system' || m.burned || m.deleted) return null;
	return m.text;
}

// Search every loaded room's in-memory messages. opts: { sender, type, limit }.
// Returns newest-first [{ roomIndex, roomName, message }] — message is the
// original entry (callers read id/text/timestamp/userName/msgType).
// HONEST SCOPE: this only covers messages currently loaded on THIS device
// (live buffer + decrypted local history merged into it). Nothing is sent
// anywhere; there is no server-side search.
export function searchMessagesAcrossRooms(rooms, query, opts = {}) {
	const q = String(query || '').trim().toLowerCase();
	if (!q || !Array.isArray(rooms)) return [];
	const sender = String(opts.sender || '').trim().toLowerCase();
	const type = String(opts.type || '').trim().toLowerCase();
	const limit = Math.max(1, opts.limit || 50);
	const hits = [];
	for (let ri = 0; ri < rooms.length; ri++) {
		const room = rooms[ri];
		if (!room || !Array.isArray(room.messages)) continue;
		for (let i = room.messages.length - 1; i >= 0; i--) {
			const m = room.messages[i];
			const text = searchableText(m);
			if (text === null) continue;
			if (!text.toLowerCase().includes(q)) continue;
			if (type && baseMsgType(m) !== type) continue;
			if (sender && senderOf(m, room).toLowerCase().indexOf(sender) === -1) continue;
			hits.push({ roomIndex: ri, roomName: room.roomName || '', message: m });
		}
	}
	hits.sort((a, b) => (b.message.timestamp || 0) - (a.message.timestamp || 0));
	return hits.slice(0, limit);
}

// ---------- 47: password strength + generation ----------

const PW_SETS = {
	lower: 'abcdefghijkmnopqrstuvwxyz',
	upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
	digit: '23456789',
	symbol: '!@#$%^&*()-_=+'
};

// Score 0..4. Deliberately simple + explainable: length, character classes,
// and penalties for repeats / single-class passwords. Not a zxcvbn clone.
export function passwordStrength(password) {
	const pw = String(password || '');
	if (!pw) return { score: 0, level: 'empty' };
	let score = 0;
	if (pw.length >= 8) score++;
	if (pw.length >= 12) score++;
	if (pw.length >= 16) score++;
	let classes = 0;
	if (/[a-z]/.test(pw)) classes++;
	if (/[A-Z]/.test(pw)) classes++;
	if (/[0-9]/.test(pw)) classes++;
	if (/[^A-Za-z0-9]/.test(pw)) classes++;
	if (classes >= 2) score++;
	if (classes >= 3) score++;
	if (classes <= 1) score -= 1;
	if (/(.)\1\1/.test(pw)) score -= 1; // triple repeat
	if (/^(.)\1*$/.test(pw)) score = 0;
	score = Math.max(0, Math.min(4, score));
	const level = score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';
	return { score, level };
}

export function isWeakPassword(password) {
	return passwordStrength(password).level !== 'good' && passwordStrength(password).level !== 'strong';
}

// Generate a strong password locally. randomBytes(n) is injectable for
// tests; in the browser it defaults to crypto.getRandomValues.
export function generateStrongPassword(length = 20, randomBytes = null) {
	const len = Math.max(12, Math.min(64, length | 0));
	const all = PW_SETS.lower + PW_SETS.upper + PW_SETS.digit + PW_SETS.symbol;
	const rand = randomBytes || ((n) => {
		const buf = new Uint8Array(n);
		(globalThis.crypto || {}).getRandomValues
			? globalThis.crypto.getRandomValues(buf)
			: buf.forEach((_, i) => { buf[i] = Math.floor(Math.random() * 256); });
		return buf;
	});
	const pick = (set) => set[rand(1)[0] % set.length];
	let pw = pick(PW_SETS.lower) + pick(PW_SETS.upper) + pick(PW_SETS.digit) + pick(PW_SETS.symbol);
	while (pw.length < len) pw += pick(all);
	// Fisher–Yates shuffle so the guaranteed classes are not always up front.
	const chars = pw.split('');
	const bytes = rand(chars.length);
	for (let i = chars.length - 1; i > 0; i--) {
		const j = bytes[i] % (i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join('');
}

// ---------- 43: desktop shortcuts ----------

// Classify a keydown-like event into a shortcut action, or null.
// Reserved / dangerous combos are never claimed:
// - Ctrl+Shift+Backspace is the panic wipe (handled elsewhere) — not ours.
// - Browser-reserved combos (Ctrl/Cmd+W/T/N, Ctrl+Tab…) are not touched;
//   we only claim Ctrl/Cmd+K, Alt+ArrowUp/Down and '?' help (caller gates
//   '?' to non-typing contexts).
export function classifyShortcut(e) {
	if (!e || typeof e.key !== 'string') return null;
	if (e.ctrlKey && e.shiftKey && e.key === 'Backspace') return null; // panic
	if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) return 'search';
	if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') return 'room-prev';
	if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') return 'room-next';
	if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') return 'help';
	return null;
}

export function nextRoomIndex(current, delta, count) {
	if (!count || count <= 0) return -1;
	if (current < 0) return delta >= 0 ? 0 : count - 1;
	return ((current + delta) % count + count) % count;
}

// ---------- 41: focus trap (pure index math + DOM glue) ----------

export const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Given the index of the currently focused focusable element inside a
// container (or -1), return the index Tab should move to (wrapping).
export function trapTabTarget(currentIndex, count, shiftKey) {
	if (!count || count <= 0) return -1;
	if (currentIndex === -1) return shiftKey ? count - 1 : 0;
	if (shiftKey) return currentIndex === 0 ? count - 1 : currentIndex - 1;
	return currentIndex === count - 1 ? 0 : currentIndex + 1;
}

let lastFocusedBeforeModal = null;

// Open-side of a modal: remember focus, move focus into the container.
export function focusIntoModal(container) {
	try { lastFocusedBeforeModal = document.activeElement; } catch (_e) { lastFocusedBeforeModal = null; }
	if (!container) return;
	const f = container.querySelectorAll(FOCUSABLE_SELECTOR);
	const target = f && f.length ? f[0] : container;
	try { target.focus(); } catch (_e) { /* best-effort */ }
}

// Handle Tab inside an open modal (focus trap). Returns true if handled.
export function handleModalTab(container, event) {
	if (!container || !event || event.key !== 'Tab') return false;
	const items = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
		.filter(el => el.offsetParent !== null || el === document.activeElement);
	if (!items.length) return false;
	const idx = items.indexOf(document.activeElement);
	const next = trapTabTarget(idx, items.length, !!event.shiftKey);
	if (next === -1) return false;
	// Only intercept when focus would leave the container (or is outside).
	if (idx === -1 || (event.shiftKey && idx === 0) || (!event.shiftKey && idx === items.length - 1)) {
		event.preventDefault();
		try { items[next].focus(); } catch (_e) { /* best-effort */ }
		return true;
	}
	return false;
}

// Close-side: give focus back to whatever opened the modal.
export function restoreModalFocus() {
	const el = lastFocusedBeforeModal;
	lastFocusedBeforeModal = null;
	if (el && typeof el.focus === 'function') {
		try { el.focus(); } catch (_e) { /* best-effort */ }
	}
}

// ---------- 41: live regions (throttled announcements) ----------

// Throttled announcer: at most one write per minInterval; bursts coalesce
// to the LATEST message (a screen reader must not be flooded during a
// message storm). now/schedule injectable for tests.
export function createThrottledAnnouncer(write, minInterval = 1500, now = Date.now, schedule = (fn, ms) => setTimeout(fn, ms)) {
	let lastAt = 0;
	let pending = null;
	let timerOn = false;
	function flush() {
		timerOn = false;
		if (pending === null) return;
		const msg = pending;
		pending = null;
		lastAt = now();
		write(msg);
	}
	return function announce(msg) {
		if (!msg) return;
		const wait = minInterval - (now() - lastAt);
		if (wait <= 0 && !timerOn) {
			lastAt = now();
			write(msg);
			return;
		}
		pending = msg; // coalesce: only the latest survives
		if (!timerOn) {
			timerOn = true;
			schedule(flush, Math.max(0, wait));
		}
	};
}

const liveWriters = {};
function liveRegionEl(kind) {
	if (typeof document === 'undefined') return null;
	let el = document.getElementById('jmlt-live-' + kind);
	if (!el) {
		el = document.createElement('div');
		el.id = 'jmlt-live-' + kind;
		el.className = 'sr-only';
		el.setAttribute('aria-live', 'polite');
		el.setAttribute('aria-atomic', 'true');
		document.body.appendChild(el);
	}
	return el;
}

// Announce via the shared polite live region. kind separates streams so a
// typing announcement does not starve a new-message announcement.
// kind: 'message' (1500ms) | 'typing' (4000ms).
export function announceLive(msg, kind = 'message') {
	const el = liveRegionEl(kind);
	if (!el) return;
	if (!liveWriters[kind]) {
		liveWriters[kind] = createThrottledAnnouncer((text) => {
			// Clear first so identical consecutive texts are re-announced.
			el.textContent = '';
			el.textContent = text;
		}, kind === 'typing' ? 4000 : 1500);
	}
	liveWriters[kind](msg);
}

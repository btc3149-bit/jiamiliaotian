// ==================== Local history search (split from chat.js, item 48) ====================
// 搜索簇：从 chat.js 拆出。SECURITY：只在内存态 rd.messages 上扫描（本地
// 历史加载后本就合并进该缓冲），零新增存储；高亮用 DOM text-node 切分
// 构建，不拼 innerHTML（不变量 5）。
// The not-in-view notice goes through an injected notifier (set by
// chat.js) — same explicit-injection pattern as setReadReceiptSender,
// avoiding a chat.js <-> chat.search.js import cycle.
// chat.js keeps the original export names as a forwarding layer.

import { roomsData, activeRoomIndex, switchRoom } from './room.js';
import { createElement, on, addClass, removeClass } from './util.dom.js';
import { escapeHTML } from './util.string.js';
import { searchMessagesAcrossRooms } from './util.a11yUx.js';
import { t } from './util.i18n.js';

let notifySystem = () => {};
export function setSearchNotifier(fn) {
	if (typeof fn === 'function') notifySystem = fn;
}

// ==================== v1.1.0: local history search ====================
// 本地历史搜索。SECURITY：只在内存态 rd.messages 上扫描（本地历史加载后
// 本就合并进该缓冲），零新增存储；焚毁/撤回条目 text 已置 null 天然不可搜。
// 高亮用 DOM text-node 切分构建，不拼 innerHTML（不变量 5）。

let searchDebounceTimer = null;

export function setupSearchUI() {
	const btn = document.querySelector('.chat-search-btn');
	if (btn && btn.dataset.searchSetup !== '1') {
		btn.dataset.searchSetup = '1';
		on(btn, 'click', toggleSearchBar)
	}
	const main = document.querySelector('.main');
	if (!main || document.getElementById('jmlt-search-wrap')) return;
	const wrap = createElement('div', { id: 'jmlt-search-wrap', class: 'jmlt-search-wrap', style: 'display:none' });
	wrap.innerHTML = [
		'<div class="jmlt-search-bar">',
		'<input type="text" id="jmlt-search-input" class="jmlt-search-input" placeholder="">',
		'<button type="button" class="jmlt-search-close" id="jmlt-search-close" aria-label="✕">✕</button>',
		'</div>',
		'<div class="jmlt-search-filters">',
		'<input type="text" id="jmlt-search-sender" class="jmlt-search-sender" placeholder="">',
		'<select id="jmlt-search-type" class="jmlt-search-type">',
		'<option value="">' + escapeHTML(t('search.type_all', 'All types')) + '</option>',
		'<option value="text">' + escapeHTML(t('search.type_text', 'Text')) + '</option>',
		'<option value="image">' + escapeHTML(t('search.type_image', 'Image')) + '</option>',
		'<option value="file">' + escapeHTML(t('search.type_file', 'File')) + '</option>',
		'<option value="voice">' + escapeHTML(t('search.type_voice', 'Voice')) + '</option>',
		'</select>',
		'</div>',
		// Item 45: honest scope — this is a LOCAL search over messages loaded
		// on this device only; never imply server-side full search.
		'<div class="jmlt-search-scope">' + escapeHTML(t('search.scope', 'Local search only: covers messages loaded on this device (open rooms + local history kept here). The server stores nothing and cannot search.')) + '</div>',
		'<div class="jmlt-search-results" id="jmlt-search-results"></div>'
	].join('');
	main.insertBefore(wrap, main.querySelector('.chat-area'));
	const input = wrap.querySelector('#jmlt-search-input');
	on(input, 'input', () => {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(runSearch, 250)
	});
	const senderInput = wrap.querySelector('#jmlt-search-sender');
	if (senderInput) {
		senderInput.placeholder = t('search.filter_sender', 'Sender');
		senderInput.setAttribute('aria-label', t('search.filter_sender', 'Sender'));
		on(senderInput, 'input', () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
			searchDebounceTimer = setTimeout(runSearch, 250)
		});
	}
	const typeSel = wrap.querySelector('#jmlt-search-type');
	if (typeSel) {
		typeSel.setAttribute('aria-label', t('search.filter_type', 'Type'));
		on(typeSel, 'change', runSearch);
	}
	on(input, 'keydown', (e) => {
		if (e.key === 'Escape') toggleSearchBar()
	});
	on(wrap.querySelector('#jmlt-search-close'), 'click', toggleSearchBar);
}

export function toggleSearchBar() {
	const wrap = document.getElementById('jmlt-search-wrap');
	if (!wrap) return;
	const show = wrap.style.display === 'none';
	wrap.style.display = show ? 'block' : 'none';
	if (show) {
		const input = wrap.querySelector('#jmlt-search-input');
		input.placeholder = t('search.cross_placeholder', 'Search all loaded rooms…');
		input.focus();
		runSearch()
	} else {
		wrap.querySelector('#jmlt-search-results').innerHTML = ''
	}
}

function runSearch() {
	const wrap = document.getElementById('jmlt-search-wrap');
	if (!wrap || wrap.style.display === 'none') return;
	const input = wrap.querySelector('#jmlt-search-input');
	const results = wrap.querySelector('#jmlt-search-results');
	const q = (input.value || '').trim();
	results.innerHTML = '';
	if (!q) {
		results.appendChild(createElement('div', { class: 'jmlt-search-hint' },
			t('search.hint', 'Type to search messages in this room')));
		return
	}
	// Item 45: search ALL loaded rooms on this device (live buffers already
	// include decrypted local history merged at join). Pure local — the
	// scope note in the UI states this honestly.
	const senderEl = wrap.querySelector('#jmlt-search-sender');
	const typeEl = wrap.querySelector('#jmlt-search-type');
	const hits = searchMessagesAcrossRooms(roomsData, q, {
		sender: senderEl ? senderEl.value : '',
		type: typeEl ? typeEl.value : '',
		limit: 50
	});
	if (hits.length === 0) {
		results.appendChild(createElement('div', { class: 'jmlt-search-hint' },
			t('search.no_results', 'No results')));
		return
	}
	const qLower = q.toLowerCase();
	for (const hit of hits) {
		const m = hit.message;
		const room = roomsData[hit.roomIndex];
		const row = createElement('div', { class: 'jmlt-search-row', 'data-mid': m.id || '' });
		const meta = createElement('div', { class: 'jmlt-search-row-meta' });
		const ts = m.timestamp ? new Date(m.timestamp) : null;
		const senderName = m.type === 'me' ? ((room && room.myUserName) || '') : (m.userName || '');
		meta.textContent = (ts ? ts.toLocaleString() : '') + ' · ' + senderName + ' · ' +
			t('search.in_room', 'in #{room}').replace('{room}', (room && room.roomName) || hit.roomName || '');
		// snippet with safe <mark> via DOM construction (no innerHTML concatenation)
		const snip = createElement('div', { class: 'jmlt-search-row-snip' });
		const text = typeof m.text === 'string' ? m.text : '';
		const lower = text.toLowerCase();
		let pos = 0;
		for (;;) {
			const at = lower.indexOf(qLower, pos);
			if (at === -1) {
				snip.appendChild(document.createTextNode(text.slice(pos)));
				break
			}
			snip.appendChild(document.createTextNode(text.slice(pos, at)));
			const mark = document.createElement('mark');
			mark.textContent = text.slice(at, at + qLower.length);
			snip.appendChild(mark);
			pos = at + qLower.length
		}
		row.appendChild(meta);
		row.appendChild(snip);
		on(row, 'click', () => {
			// Item 45: switch room first, then jump once the room rendered.
			if (hit.roomIndex !== activeRoomIndex) switchRoom(hit.roomIndex);
			requestAnimationFrame(() => jumpToMessage(m.id));
		});
		results.appendChild(row)
	}
}

function jumpToMessage(mid) {
	if (!mid) return;
	const el = document.querySelector('#chat-area [data-mid="' + mid + '"]');
	if (!el) {
		notifySystem(t('search.not_loaded', 'This message is not in the current view (older than loaded history).'), true);
		return
	}
	el.scrollIntoView({ block: 'center', behavior: 'smooth' });
	addClass(el, 'search-hit');
	setTimeout(() => removeClass(el, 'search-hit'), 1500)
}


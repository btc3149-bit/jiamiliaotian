// ==================== Local history search (split from chat.js, item 48) ====================
// 搜索簇：从 chat.js 拆出。SECURITY：只在内存态 rd.messages 上扫描（本地
// 历史加载后本就合并进该缓冲），零新增存储；高亮用 DOM text-node 切分
// 构建，不拼 innerHTML（不变量 5）。
// The not-in-view notice goes through an injected notifier (set by
// chat.js) — same explicit-injection pattern as setReadReceiptSender,
// avoiding a chat.js <-> chat.search.js import cycle.
// chat.js keeps the original export names as a forwarding layer.

import { roomsData, activeRoomIndex } from './room.js';
import { createElement, on, addClass, removeClass } from './util.dom.js';
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
		'<button type="button" class="jmlt-search-close" id="jmlt-search-close">✕</button>',
		'</div>',
		'<div class="jmlt-search-results" id="jmlt-search-results"></div>'
	].join('');
	main.insertBefore(wrap, main.querySelector('.chat-area'));
	const input = wrap.querySelector('#jmlt-search-input');
	on(input, 'input', () => {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(runSearch, 250)
	});
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
		input.placeholder = t('search.placeholder', 'Search in this room…');
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
	const q = (input.value || '').trim().toLowerCase();
	results.innerHTML = '';
	const rd = roomsData[activeRoomIndex];
	if (!rd) return;
	if (!q) {
		results.appendChild(createElement('div', { class: 'jmlt-search-hint' },
			t('search.hint', 'Type to search messages in this room')));
		return
	}
	const hits = [];
	for (let i = rd.messages.length - 1; i >= 0 && hits.length < 50; i--) {
		const m = rd.messages[i];
		if (!m || m.type === 'system' || m.burned || m.deleted) continue;
		if (typeof m.text !== 'string' || !m.text.toLowerCase().includes(q)) continue;
		hits.push(m)
	}
	if (hits.length === 0) {
		results.appendChild(createElement('div', { class: 'jmlt-search-hint' },
			t('search.no_results', 'No results')));
		return
	}
	for (const m of hits) {
		const row = createElement('div', { class: 'jmlt-search-row', 'data-mid': m.id || '' });
		const meta = createElement('div', { class: 'jmlt-search-row-meta' });
		const ts = m.timestamp ? new Date(m.timestamp) : null;
		meta.textContent = (ts ? ts.toLocaleString() : '') + ' · ' + (m.type === 'me' ? (rd.myUserName || '') : (m.userName || ''));
		// snippet with safe <mark> via DOM construction (no innerHTML concatenation)
		const snip = createElement('div', { class: 'jmlt-search-row-snip' });
		const lower = m.text.toLowerCase();
		let pos = 0;
		for (;;) {
			const at = lower.indexOf(q, pos);
			if (at === -1) {
				snip.appendChild(document.createTextNode(m.text.slice(pos)));
				break
			}
			snip.appendChild(document.createTextNode(m.text.slice(pos, at)));
			const mark = document.createElement('mark');
			mark.textContent = m.text.slice(at, at + q.length);
			snip.appendChild(mark);
			pos = at + q.length
		}
		row.appendChild(meta);
		row.appendChild(snip);
		on(row, 'click', () => jumpToMessage(m.id));
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

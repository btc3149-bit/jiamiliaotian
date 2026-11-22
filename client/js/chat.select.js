// ==================== Multi-select forward / copy (split from chat.js, item 48) ====================
// 多选簇：从 chat.js 拆出。SECURITY：转发 = 把选中文本作为新消息经目标
// 房间的 sendChannelMessage **重新加密**发送（不复用原信封——不同房间
// 密钥不同）；私聊消息禁止跨房转发（作用域守卫，延续 P1-B 模式）。
// System notices go through an injected notifier (set by chat.js) —
// setReadReceiptSender pattern, no import cycle. findMessageById is
// re-implemented locally (one-line lookup over rd.messages).
// chat.js keeps the original export names as a forwarding layer.

import { roomsData, activeRoomIndex } from './room.js';
import { escapeHTML } from './util.string.js';
import { $id, createElement, createElementHTML, on, addClass, removeClass } from './util.dom.js';
import { t } from './util.i18n.js';

let notifySystem = () => {};
export function setSelectNotifier(fn) {
	if (typeof fn === 'function') notifySystem = fn;
}

function findMessageById(rd, mid) {
	return rd.messages.find(m => m.id === mid) || null
}

// ==================== v1.1.0: multi-select forward / copy ====================
// 多选转发/复制。SECURITY：转发 = 把选中文本作为新消息经目标房间的
// sendChannelMessage **重新加密**发送（不复用原信封——不同房间密钥不同）；
// 私聊消息禁止跨房转发（作用域守卫，延续 P1-B 模式）。

const selectedForAction = new Set();
let selectMode = false;
let longPressTimer = null;

function isPrivateMsgType(msgType) {
	return typeof msgType === 'string' && msgType.indexOf('_private') !== -1
}

export function exitSelectMode() {
	if (!selectMode) return;
	selectMode = false;
	selectedForAction.clear();
	const area = $id('chat-area');
	if (area) {
		removeClass(area, 'selecting');
		const els = area.querySelectorAll('.selected');
		for (const el of els) removeClass(el, 'selected')
	}
	const bar = document.getElementById('jmlt-select-bar');
	if (bar) bar.remove()
}

function enterSelectMode(firstMid) {
	if (selectMode) return;
	selectMode = true;
	const area = $id('chat-area');
	if (area) addClass(area, 'selecting');
	const rd = roomsData[activeRoomIndex];
	if (rd && firstMid) toggleSelect(firstMid);
	else renderSelectBar()
}

function toggleSelect(mid) {
	if (!mid) return;
	if (selectedForAction.has(mid)) {
		selectedForAction.delete(mid)
	} else {
		selectedForAction.add(mid)
	}
	const el = document.querySelector('#chat-area [data-mid="' + mid + '"]');
	if (el) {
		if (selectedForAction.has(mid)) addClass(el, 'selected');
		else removeClass(el, 'selected')
	}
	renderSelectBar()
}

function renderSelectBar() {
	let bar = document.getElementById('jmlt-select-bar');
	if (!selectMode) {
		if (bar) bar.remove();
		return
	}
	if (!bar) {
		bar = createElementHTML('div', { id: 'jmlt-select-bar', class: 'jmlt-select-bar' }, [
			'<span class="jmlt-sel-count"></span>',
			'<button type="button" class="jmlt-sel-copy"></button>',
			'<button type="button" class="jmlt-sel-forward"></button>',
			'<button type="button" class="jmlt-sel-cancel"></button>'
		].join(''));
		document.body.appendChild(bar);
		on(bar.querySelector('.jmlt-sel-copy'), 'click', doCopySelected);
		on(bar.querySelector('.jmlt-sel-forward'), 'click', doForwardSelected);
		on(bar.querySelector('.jmlt-sel-cancel'), 'click', exitSelectMode);
		ensureSelectBarText()
	}
	const countEl = bar.querySelector('.jmlt-sel-count');
	const n = selectedForAction.size;
	countEl.textContent = t('search.selected_count', 'Selected: {n}').replace('{n}', String(n));
	bar.querySelector('.jmlt-sel-copy').disabled = n === 0;
	bar.querySelector('.jmlt-sel-forward').disabled = n === 0
}

function ensureSelectBarText() {
	const bar = document.getElementById('jmlt-select-bar');
	if (!bar) return;
	bar.querySelector('.jmlt-sel-copy').textContent = t('search.copy', 'Copy');
	bar.querySelector('.jmlt-sel-forward').textContent = t('search.forward', 'Forward');
	bar.querySelector('.jmlt-sel-cancel').textContent = t('ui.cancel', 'Cancel');
}

function collectSelectedTexts() {
	const rd = roomsData[activeRoomIndex];
	if (!rd) return [];
	const out = [];
	for (const mid of selectedForAction) {
		const e = findMessageById(rd, mid);
		if (!e || e.burned || e.deleted) continue;
		if (typeof e.text !== 'string' || e.text.length === 0) continue;
		out.push(e)
	}
	return out
}

async function doCopySelected() {
	const entries = collectSelectedTexts();
	if (entries.length === 0) return;
	const rd = roomsData[activeRoomIndex];
	const lines = entries.map((e) => {
		const who = e.type === 'me' ? (rd.myUserName || '') : (e.userName || '');
		const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : '';
		return '[' + ts + '] ' + who + ': ' + e.text
	});
	try {
		await navigator.clipboard.writeText(lines.join('\n'));
		exitSelectMode()
	} catch (_e) {
		notifySystem(t('search.copy_failed', 'Clipboard unavailable'), true)
	}
}

function doForwardSelected() {
	const entries = collectSelectedTexts();
	if (entries.length === 0) return;
	// scope guard: private messages never leave their room
	// 作用域守卫：私聊消息禁止跨房转发
	const forwardable = entries.filter((e) => !isPrivateMsgType(e.msgType));
	const skipped = entries.length - forwardable.length;
	if (forwardable.length === 0) {
		notifySystem(t('search.forward_private_blocked', 'Private messages cannot be forwarded to other rooms.'), true);
		return
	}
	const targets = [];
	for (let i = 0; i < roomsData.length; i++) {
		const r = roomsData[i];
		if (i !== activeRoomIndex && r && r.chat && r.roomName) targets.push({ idx: i, name: r.roomName })
	}
	if (targets.length === 0) {
		notifySystem(t('search.no_other_rooms', 'Open another room first to forward messages.'), true);
		return
	}
	const modal = createElementHTML('div', { class: 'file-upload-modal show' }, [
		'<div class="file-upload-overlay"></div>',
		'<div class="file-upload-container">',
		'<div class="file-upload-header"><h3>' + escapeHTML(t('search.forward_to', 'Forward to…')) + '</h3><button class="file-upload-close jmlt-fwd-close">&times;</button></div>',
		'<div class="file-upload-content"><div class="jmlt-fwd-list"></div></div>',
		'</div>',
		'</div>'
	].join(''));
	document.body.appendChild(modal);
	const list = modal.querySelector('.jmlt-fwd-list');
	const close = () => { if (modal.parentNode) modal.parentNode.removeChild(modal) };
	on(modal.querySelector('.file-upload-overlay'), 'click', close);
	on(modal.querySelector('.jmlt-fwd-close'), 'click', close);
	for (const tgt of targets) {
		const row = createElement('button', { type: 'button', class: 'jmlt-fwd-room' });
		row.textContent = '#' + tgt.name;
		on(row, 'click', () => {
			close();
			const targetRd = roomsData[tgt.idx];
			let sent = 0;
			for (const e of forwardable) {
				try {
					const mid = targetRd.chat.sendChannelMessage('text', e.text);
					if (mid) {
						sent++;
						targetRd.messages.push({
							type: 'me',
							text: e.text,
							msgType: 'text',
							timestamp: Date.now(),
							id: mid,
							reactions: null,
							mentions: null,
							mentionsMe: false
						})
					}
				} catch (_err) { /* per-entry best-effort */ }
			}
			exitSelectMode();
			const note = t('search.forwarded', 'Forwarded {n} message(s) to #{room}').replace('{n}', String(sent)).replace('{room}', tgt.name);
			const extra = skipped > 0
				? ' (' + t('search.private_skipped', '{n} private message(s) skipped').replace('{n}', String(skipped)) + ')'
				: '';
			notifySystem(note + extra, true)
		});
		list.appendChild(row)
	}
	ensureSelectBarText()
}

// wire up: right-click (desktop) / long-press (touch) on a bubble enters select mode
export function setupSelectModeUI() {
	const area = $id('chat-area');
	if (!area || area.dataset.selSetup === '1') return;
	area.dataset.selSetup = '1';
	on(area, 'contextmenu', (e) => {
		const bubble = e.target.closest('[data-mid]');
		if (!bubble || bubble.classList.contains('recalled')) return;
		e.preventDefault();
		enterSelectMode(bubble.getAttribute('data-mid'))
	});
	on(area, 'click', (e) => {
		if (!selectMode) return;
		const bubble = e.target.closest('[data-mid]');
		if (!bubble || bubble.classList.contains('recalled')) return;
		e.preventDefault();
		e.stopPropagation();
		toggleSelect(bubble.getAttribute('data-mid'))
	}, true);
	// long-press for touch
	on(area, 'touchstart', (e) => {
		if (!e.touches || e.touches.length !== 1) return;
		const bubble = e.target.closest('[data-mid]');
		if (!bubble || bubble.classList.contains('recalled')) return;
		longPressTimer = setTimeout(() => {
			enterSelectMode(bubble.getAttribute('data-mid'));
			longPressTimer = null
		}, 600)
	}, { passive: true });
	const cancel = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null } };
	on(area, 'touchend', cancel);
	on(area, 'touchmove', cancel);
	on(area, 'touchcancel', cancel);
	ensureSelectBarText()
}

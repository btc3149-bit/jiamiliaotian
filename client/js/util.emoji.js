// Import DOM helpers
// 导入 DOM 辅助函数
import {
	$,
	on
} from './util.dom.js';
import { t } from './util.i18n.js';

// Item 14: emoji-picker-element is loaded LAZILY via dynamic import — it is
// only needed when a picker is actually opened, so it must not sit in the
// first-screen bundle. The dynamic import produces its own chunk, which the
// Service Worker's runtime stale-while-revalidate rule caches like every
// other same-origin static .js asset (RULES.md invariant 7: static shell
// only — the chunk contains no user data).
// 条目 14：emoji-picker-element 改动态 import 懒加载（打开选择器时才需要），
// 独立 chunk 由 SW 的运行时 SWR 规则按同源静态资源缓存（不变量 7）。
let pickerLoadPromise = null;
export function loadEmojiPickerElement() {
	if (!pickerLoadPromise) {
		pickerLoadPromise = import('emoji-picker-element').catch((err) => {
			pickerLoadPromise = null; // allow a later retry
			throw err;
		});
	}
	return pickerLoadPromise;
}

// Offline / load failure fallback notice (i18n).
// 加载失败（离线等）兜底提示。
export function notifyEmojiLoadFailed() {
	const msg = t('emoji.load_failed', 'Could not load the emoji picker (offline?). Check your connection and try again.');
	if (typeof window !== 'undefined' && window.addSystemMsg) window.addSystemMsg(msg, true);
	else console.error(msg);
}

// Create a full <emoji-picker> element on demand (lazy). Used by the chat
// composer picker below and by the reaction picker in chat.js (item 20).
// 按需创建完整 emoji 选择器元素（懒加载）；正文输入与表情回应共用。
export async function createFullEmojiPicker(onPick) {
	await loadEmojiPickerElement();
	const picker = document.createElement('emoji-picker');
	if (typeof onPick === 'function') {
		picker.addEventListener('emoji-click', (event) => {
			if (event && event.detail && event.detail.unicode) onPick(event.detail.unicode);
		});
	}
	return picker;
}

// Add emoji picker styles to document
// 向文档添加 emoji 选择器样式
const addEmojiPickerStyles = () => {
	if (document.querySelector('#emoji-picker-styles')) return;
	const style = document.createElement('style');
	style.id = 'emoji-picker-styles';
	style.textContent = `emoji-picker{--background:#fff;--border-color:rgba(0,0,0,0.1);--border-radius:10px;--emoji-padding:0.4rem;--category-emoji-size:1.2rem;--font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;position:absolute;bottom:60px;left:22px;z-index:5;box-shadow:0 3px 12px rgba(0,0,0,0.15);display:none;opacity:0;transform:translateY(-10px) scale(0.95);transition:opacity 0.3s ease,transform 0.3s ease}emoji-picker.show{opacity:1;transform:translateY(0) scale(1)}`;
	document.head.appendChild(style)
};
// Setup emoji picker for chat input
// 为聊天输入框设置 emoji 选择器
export function setupEmojiPicker({
	btnSelector = '.chat-emoji-btn',
	inputSelector = '.input-message-input'
} = {}) {
	const btn = $(btnSelector);
	const input = $(inputSelector);
	if (!btn || !input) return;
	try {
		addEmojiPickerStyles();
		const oldPicker = $('emoji-picker', btn.parentNode);
		if (oldPicker) oldPicker.remove();
		let picker = null;
		let loading = false;

		function showPickerWithAnimation() {
			picker.style.display = 'block';
			// 强制触发重绘，然后添加打开动画
			picker.offsetHeight; // 强制重绘
			picker.classList.add('show');
		}

		function hidePickerWithAnimation() {
			if (!picker) return;
			picker.classList.remove('show');
			setTimeout(() => {
				picker.style.display = 'none';
			}, 300);
		}

		// Button click toggles picker; the picker element (and its library
		// chunk) is only created on the first click.
		// 按钮点击切换选择器；元素与库 chunk 在首次点击时才创建/加载。
		on(btn, 'click', async (ev) => {
			ev.stopPropagation();
			if (!picker) {
				if (loading) return;
				loading = true;
				try {
					picker = await createFullEmojiPicker((unicode) => {
						insertEmoji(input, unicode);
						hidePickerWithAnimation();
					});
					picker.style.display = 'none';
					btn.parentNode.style.position = 'relative';
					btn.parentNode.appendChild(picker);
				} catch (error) {
					console.error('Failed to initialize emoji picker:', error);
					notifyEmojiLoadFailed();
					return;
				} finally {
					loading = false;
				}
			}
			if (picker.style.display === 'none') {
				showPickerWithAnimation();
			} else {
				hidePickerWithAnimation();
			}
		});
		// Hide picker when clicking outside
		// 点击外部隐藏选择器
		on(document, 'click', (ev) => {
			if (picker && !picker.contains(ev.target) && ev.target !== btn) {
				hidePickerWithAnimation();
			}
		});
	} catch (error) {
		console.error('Failed to initialize emoji picker:', error)
	}
}
// Insert emoji into input at cursor
// 在光标处插入 emoji 到输入框
function insertEmoji(input, emoji) {
	input.focus();
	if (document.getSelection && window.getSelection) {
		let sel = window.getSelection();
		if (!sel.rangeCount) return;
		let range = sel.getRangeAt(0);
		range.deleteContents();
		range.insertNode(document.createTextNode(emoji));
		range.collapse(false);
		sel.removeAllRanges();
		sel.addRange(range)
	} else {
		input.innerText += emoji
	}
	input.dispatchEvent(new Event('input'))
}

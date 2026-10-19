// Panic wipe — one-tap removal of ALL local data (v1.1.0, feature #2).
// SECURITY / RULES.md 对照：
// - 不变量 4 的客户端终极大招：pin、设置、草稿、加密历史、SW 缓存全部清除
// - 服务器侧零改动（服务器本来就没有可清的东西——零持久化）
// - 触发需双重确认；执行不可撤销，UI 文案必须明示

import { clearAllLocalHistory } from './util.localHistory.js';

// Keys/namespaces owned by this app in web storage.
// 本应用在 web storage 中的键空间（前缀清单，避免误伤同源其他应用）。
const LS_PREFIXES = ['nodecrypt_server_key', 'jmlt_', 'settings'];
const LS_EXACT = ['settings'];

function shouldRemoveKey(key) {
	if (LS_EXACT.indexOf(key) !== -1) return true;
	return LS_PREFIXES.some((p) => key === p || key.indexOf(p + ':') === 0 || key.indexOf(p + '_') === 0)
}

export async function panicWipe() {
	// 1) web storage（含 pin、设置、草稿、房间元数据）
	try {
		const doomed = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && shouldRemoveKey(k)) doomed.push(k)
		}
		for (const k of doomed) localStorage.removeItem(k);
		sessionStorage.clear()
	} catch (_e) { /* storage may be unavailable — keep going */ }

	// 2) encrypted local history（独立于通用前缀规则，显式清）
	try {
		await clearAllLocalHistory()
	} catch (_e) { /* best-effort */ }

	// 3) service worker 缓存 + 注销（不变量 7 的缓存全部退役）
	try {
		if ('caches' in window) {
			const keys = await caches.keys();
			await Promise.all(keys.map((k) => caches.delete(k)))
		}
		if (navigator.serviceWorker) {
			const regs = await navigator.serviceWorker.getRegistrations();
			await Promise.all(regs.map((r) => r.unregister()))
		}
	} catch (_e) { /* best-effort */ }

	// 4) notifications（本应用的授权无法程序化撤销，文档说明即可）
	// 5) reload into a clean shell
	try {
		location.replace('./')
	} catch (_e) {
		location.reload()
	}
}

// Double-confirm gate. NEVER wipe on a single click.
// 双重确认闸门：绝不单击触发。
export async function panicWipeWithConfirm() {
	const step1 = window.confirm(
		'⚠️ ' + '即从此设备清除本应用的全部本地数据：\n' +
		'房间密钥 pin、设置、草稿、加密历史、缓存。\n\n' +
		'This wipes ALL local app data from this device (pins, settings, drafts, encrypted history, caches).'
	);
	if (!step1) return false;
	const step2 = window.confirm(
		'最后确认：此操作不可撤销，且不会影响其他设备或服务器（服务器本来就没有你的数据）。\n\n' +
		'Final check: this cannot be undone and does not affect other devices (the server never had your data).'
	);
	if (!step2) return false;
	await panicWipe();
	return true
}

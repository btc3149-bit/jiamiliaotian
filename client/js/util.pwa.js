// PWA：Service Worker 注册 + 安装提示捕获
//
// 安全边界：SW 只缓存静态应用壳，绝不缓存消息内容或用户数据（详见 client/public/sw.js 头注释）。

let deferredPrompt = null;

/**
 * 初始化 PWA 支持：注册 SW、捕获 beforeinstallprompt。
 * 调用时机安全：可在模块加载时直接调用（内部挂在 window load 上）。
 */
export function initPWA() {
	if (!('serviceWorker' in navigator)) return;

	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js').catch(() => {
			// SW 注册失败不影响聊天主功能，静默降级
		});
	});

	window.addEventListener('beforeinstallprompt', (e) => {
		// 阻止 Chrome 默认横幅，改为由设置面板/事件消费方决定何时提示
		e.preventDefault();
		deferredPrompt = e;
		window.__jmltCanInstall = true;
		window.dispatchEvent(new CustomEvent('jmltInstallAvailable'));
	});

	window.addEventListener('appinstalled', () => {
		deferredPrompt = null;
		window.__jmltCanInstall = false;
	});
}

/**
 * 触发浏览器安装弹窗（需 beforeinstallprompt 已捕获）。
 * @returns {Promise<boolean>} 用户是否接受安装
 */
export async function promptInstall() {
	if (!deferredPrompt) return false;
	deferredPrompt.prompt();
	let accepted = false;
	try {
		const choice = await deferredPrompt.userChoice;
		accepted = !!(choice && choice.outcome === 'accepted');
	} catch (_err) { /* ignore */ }
	deferredPrompt = null;
	window.__jmltCanInstall = false;
	return accepted;
}

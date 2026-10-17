// Dark mode with system-preference following
// 深色模式：跟随系统 / 强制浅色 / 强制深色
//
// 设置项 settings.darkMode: 'auto'（默认，跟随 prefers-color-scheme）| 'light' | 'dark'
// 实现方式：html[data-mode="dark"] 属性 + style.css 的覆盖规则块。
// 纯外观层，不触碰任何加密/网络路径（RULES.md 第一准则无关项）。

const DARK_QUERY = '(prefers-color-scheme: dark)';
let mediaListener = null;

function resolveEffective(mode) {
	if (mode === 'dark') return true;
	if (mode === 'light') return false;
	// auto: follow the OS
	return window.matchMedia && window.matchMedia(DARK_QUERY).matches
}

function setMode(mode) {
	const effective = resolveEffective(mode);
	if (effective) {
		document.documentElement.setAttribute('data-mode', 'dark')
	} else {
		document.documentElement.removeAttribute('data-mode')
	}
}

// Apply the dark-mode setting ('auto' | 'light' | 'dark').
// 应用深色模式设置。
export function applyDarkModeSetting(mode) {
	// reset any previous system-change listener
	if (mediaListener && window.matchMedia) {
		try {
			window.matchMedia(DARK_QUERY).removeEventListener('change', mediaListener)
		} catch (error) { /* older browsers */ }
		mediaListener = null
	}
	if (mode !== 'dark' && mode !== 'light') mode = 'auto';
	if (mode === 'auto' && window.matchMedia) {
		try {
			mediaListener = () => setMode('auto');
			window.matchMedia(DARK_QUERY).addEventListener('change', mediaListener)
		} catch (error) { /* older browsers: no dynamic follow */ }
	}
	setMode(mode)
}

// Read the current dark-mode setting from localStorage ('auto' by default).
export function getDarkModeSetting() {
	try {
		const settings = JSON.parse(localStorage.getItem('settings') || '{}');
		const mode = settings.darkMode;
		return (mode === 'dark' || mode === 'light') ? mode : 'auto'
	} catch (error) {
		return 'auto'
	}
}

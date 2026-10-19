// Import DOM utility functions
// 导入 DOM 工具函数
import {
	$,
	$$,
	$id,
	createElement,
	on,
	off,
	addClass,
	removeClass
} from './util.dom.js';

// Import theme utilities
// 导入主题工具函数
import { THEMES, getCurrentTheme, applyTheme } from './util.theme.js';

// Import i18n utilities
// 导入国际化工具函数
import { t, setLanguage, getCurrentLanguage, initI18n } from './util.i18n.js';
// P3: dark mode (system-following) + local encrypted history
import { applyDarkModeSetting } from './util.darkmode.js';
import { clearAllLocalHistory } from './util.localHistory.js';
// P1-C: Web Push (generic, payload-free notifications)
import { enablePush, disablePush, isPushEnabled, isPushSupported } from './util.push.js';
// v1.1.0 #2: panic wipe (double-confirmed local data removal)
import { panicWipeWithConfirm } from './util.panic.js';
// Default settings
// 默认设置
const DEFAULT_SETTINGS = {
	notify: false,
	sound: false,
	theme: 'theme1',
	darkMode: 'auto', // 'auto' 跟随系统 | 'light' | 'dark'
	localHistory: false, // 本地加密消息历史（可选，默认关闭）
	sendOriginal: false // v1.1.0 #10：发送原图（默认关 = 自动压缩 + 剥 EXIF）
	// 注意：我们不设置默认语言，让系统自动检测浏览器语言
	// Note: We don't set a default language, let the system auto-detect browser language
};

// Load settings from localStorage
// 从 localStorage 加载设置
function loadSettings() {
	let s = localStorage.getItem('settings');
	try {
		s = s ? JSON.parse(s) : {}
	} catch {
		s = {}
	}
	return {
		...DEFAULT_SETTINGS,
		...s
	}
}

// Save settings to localStorage
// 保存设置到 localStorage
function saveSettings(settings) {
	const {
		notify,
		sound,
		theme,
		language,
		darkMode,
		localHistory,
		sendOriginal
	} = settings;
	localStorage.setItem('settings', JSON.stringify({
		notify,
		sound,
		theme,
		language,
		darkMode,
		localHistory,
		sendOriginal
	}))
}

// Apply settings to the document
// 应用设置到文档
function applySettings(settings) {
	// Initialize i18n with current language setting
	// 根据当前语言设置初始化国际化
	initI18n(settings);
	// P3: apply dark mode (auto/light/dark)
	// P3：应用深色模式设置
	applyDarkModeSetting(settings.darkMode)
}

// Ask for browser notification permission
// 请求浏览器通知权限
function askNotificationPermission(callback) {
	if (Notification.requestPermission.length === 0) {
		Notification.requestPermission().then(callback)
	} else {
		Notification.requestPermission(callback)
	}
}

// P1-D: read + escape the stored server URL for the settings input value.
// 读取并转义存储的服务器地址（输入框 value 属性防注入）。
function escapeHTMLServerUrl(value) {
	return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function getStoredServerUrl() {
	try { return localStorage.getItem('jmlt_server_url') || ''; } catch (_e) { return ''; }
}

// v1.1.0 #5: current room's channel hash, used as the per-room mute key.
// roomsData/activeRoomIndex live on window (same pattern as util.file.js) to
// avoid a circular import with room.js.
// v1.1.0 #5：当前房间的 channel hash，用作房间静音键。roomsData/
// activeRoomIndex 走 window（与 util.file.js 同款模式，避免与 room.js 循环导入）。
function currentRoomHash() {
	try {
		const rd = window.roomsData && window.roomsData[window.activeRoomIndex];
		return rd && rd.chat && rd.chat.credentials ? rd.chat.credentials.channel : '';
	} catch (_e) { return ''; }
}
function currentRoomMuted() {
	const h = currentRoomHash();
	if (!h) return false;
	try { return localStorage.getItem('jmlt_mute_' + h) === '1'; } catch (_e) { return false; }
}

// Setup the settings panel UI
// 设置设置面板 UI
function setupSettingsPanel() {
	const settingsSidebar = $id('settings-sidebar');
	const settingsContent = $id('settings-content');
	const settingsTitle = $id('settings-title');
	if (!settingsSidebar || !settingsContent) return;

	const settings = loadSettings();
	
	// Update settings title
	// 更新设置标题
	if (settingsTitle) {
		settingsTitle.textContent = t('settings.title', 'Settings');
	}// Create settings content HTML
	settingsContent.innerHTML = `
		<div class="settings-section">
			<div class="settings-section-title">${t('settings.notification', 'Notification Settings')}</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.desktop_notifications', 'Desktop Notifications')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-notify" ${settings.notify ? 'checked' : ''}>
					<span class="slider"></span>
				</label>
			</div>
		<div class="settings-item">
			<div class="settings-item-label">
				<div>${t('settings.sound_notifications', 'Sound Notifications')}</div>
			</div>
			<label class="switch">
				<input type="checkbox" id="settings-sound" ${settings.sound ? 'checked' : ''}>
				<span class="slider"></span>
			</label>
		</div>
		<div class="settings-item">
			<div class="settings-item-label">
				<div>${t('settings.web_push', 'Offline Push (PWA installed)')}</div>
				<div class="settings-item-desc">${t('settings.web_push_desc', 'Wake this device when a new message arrives while the app is closed. The notification only ever says "you have a new message" — never the room, sender or content. Requires HTTPS.')}</div>
			</div>
			<label class="switch">
				<input type="checkbox" id="settings-web-push" ${isPushEnabled() ? 'checked' : ''}>
				<span class="slider"></span>
			</label>
		</div>
	</div>
		<div class="settings-section">
			<div class="settings-section-title">${t('settings.appearance_privacy', 'Appearance & Privacy')}</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.dark_mode', 'Dark Mode')}</div>
				</div>
				<div class="language-selector">
					<select id="settings-dark-mode" class="language-select">
						<option value="auto" ${settings.darkMode !== 'dark' && settings.darkMode !== 'light' ? 'selected' : ''}>${t('settings.dark_auto', 'Follow System')}</option>
						<option value="light" ${settings.darkMode === 'light' ? 'selected' : ''}>${t('settings.dark_light', 'Light')}</option>
						<option value="dark" ${settings.darkMode === 'dark' ? 'selected' : ''}>${t('settings.dark_dark', 'Dark')}</option>
					</select>
				</div>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.local_history', 'Local Encrypted History')}</div>
					<div class="settings-item-desc">${t('settings.local_history_desc', 'Keep recent messages on this device, encrypted with the room password (AES-GCM). Nothing leaves your browser; cleared when you click the button below.')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-local-history" ${settings.localHistory ? 'checked' : ''}>
					<span class="slider"></span>
				</label>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.clear_history', 'Clear Local History')}</div>
					<div class="settings-item-desc">${t('settings.clear_history_desc', 'Delete all locally stored encrypted message history from this device.')}</div>
				</div>
				<button type="button" id="settings-clear-history" class="settings-danger-btn">${t('settings.clear_history_btn', 'Clear')}</button>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.send_original', 'Send Original Images')}</div>
					<div class="settings-item-desc">${t('settings.send_original_desc', 'By default images are re-drawn locally before sending: EXIF metadata (including GPS and device info) is stripped and large photos are compressed. Turn this on to send the untouched original file instead.')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-send-original" ${settings.sendOriginal ? 'checked' : ''}>
					<span class="slider"></span>
				</label>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.mute_room', 'Mute This Room (front-end only)')}</div>
					<div class="settings-item-desc">${t('settings.mute_room_desc', 'Silence desktop notifications and sounds for the currently open room on this device. Note: background Web Push wake-ups still occur (they never contain content).')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-mute-room" ${currentRoomMuted() ? 'checked' : ''} ${currentRoomHash() ? '' : 'disabled'}>
					<span class="slider"></span>
				</label>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.panic_wipe', 'Panic Wipe')}</div>
					<div class="settings-item-desc">${t('settings.panic_wipe_desc', 'Immediately erase EVERYTHING this app stored on this device: room key pins, settings, drafts, encrypted history and caches. Requires double confirmation and cannot be undone.')} ${t('settings.panic_wipe_hotkey', 'Shortcut: Ctrl+Shift+Backspace.')}</div>
				</div>
				<button type="button" id="settings-panic-wipe" class="settings-danger-btn">${t('settings.panic_wipe_btn', 'Wipe Everything')}</button>
			</div>
		</div>
				<div class="settings-section">
			<div class="settings-section-title">${t('settings.language', 'Language Settings')}</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.language_switch', 'Language')}</div>
				</div>
				<div class="language-selector">
					<select id="settings-language" class="language-select">
						<option value="en" ${settings.language === 'en' ? 'selected' : ''}>🇺🇸 English</option>
						<option value="zh" ${settings.language === 'zh' ? 'selected' : ''}>🇨🇳 中文</option>
					</select>
				</div>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.server_url', 'Server URL (desktop app)')}</div>
					<div class="settings-item-desc">${t('settings.server_url_desc', 'Only used by the bundled desktop app: the https:// address of your own deployment. Leave empty to use the server this page was loaded from.')}</div>
				</div>
				<div class="language-selector">
					<input type="text" id="settings-server-url" class="language-select" style="width:220px" placeholder="https://your-worker.example.workers.dev" value="${escapeHTMLServerUrl(getStoredServerUrl())}">
				</div>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.server_url_apply', 'Apply Server URL')}</div>
				</div>
				<button type="button" id="settings-server-url-save" class="settings-danger-btn" style="background:#357ae8;color:#fff">${t('settings.server_url_save', 'Save & Reload')}</button>
			</div>
		</div>
		
		<div class="settings-section">
			<div class="settings-section-title">${t('settings.theme', 'Theme Settings')}</div>
			<div class="theme-selector" id="theme-selector">
				${THEMES.map(theme => `
					<div class="theme-item ${settings.theme === theme.id ? 'active' : ''}" data-theme-id="${theme.id}" style="background: ${theme.background}; background-size: cover; background-position: center;">
					</div>
				`).join('')}
			</div>
		</div>
	`;	const notifyCheckbox = $('#settings-notify', settingsContent);
	const soundCheckbox = $('#settings-sound', settingsContent);
	const languageSelect = $('#settings-language', settingsContent);
	const darkModeSelect = $('#settings-dark-mode', settingsContent);
	const localHistoryCheckbox = $('#settings-local-history', settingsContent);
	const clearHistoryBtn = $('#settings-clear-history', settingsContent);
	
	// Language select event handler
	// 语言选择事件处理
	on(languageSelect, 'change', e => {
		const newLanguage = e.target.value;
		settings.language = newLanguage;
		
		// Set language immediately
		// 立即设置语言
		setLanguage(newLanguage);
		
		// Save settings
		// 保存设置
		saveSettings(settings);
		applySettings(settings);
		
		// Refresh the settings panel to show updated translations
		// 刷新设置面板以显示更新的翻译
		setTimeout(() => {
			setupSettingsPanel();
		}, 100);
	});
	
	on(notifyCheckbox, 'change', e => {
		const checked = e.target.checked;
		if (checked) {
			if (!('Notification' in window)) {
				alert('Notifications are not supported by your browser.');
				e.target.checked = false;
				return
			}
			askNotificationPermission(permission => {
				if (permission === 'granted') {
					settings.notify = true;
					settings.sound = false;
					if (soundCheckbox) soundCheckbox.checked = false;
					saveSettings(settings);
					applySettings(settings);					// 防止重复通知，添加一个标志位
					if (!settingsSidebar._notificationShown) {
						new Notification('Notifications enabled', {
							body: 'You will receive alerts here.'
						});
						settingsSidebar._notificationShown = true; // 设置标志位
					}
				} else {
					settings.notify = false;
					e.target.checked = false;
					saveSettings(settings);
					applySettings(settings);
					alert('Please allow notifications in your browser settings.')
				}
			})
		} else {
			settings.notify = false;
			saveSettings(settings);
			applySettings(settings);			// 重置标志位
			if (settingsSidebar._notificationShown) {
				settingsSidebar._notificationShown = false;
			}
		}
	});	on(soundCheckbox, 'change', e => {
		settings.sound = e.target.checked;
		if (settings.sound) {
			settings.notify = false;
			if (notifyCheckbox) notifyCheckbox.checked = false;
		}
		saveSettings(settings);
		applySettings(settings)
	});
	// P1-C: Web Push toggle. Enable = permission + subscribe + report over
	// E2EE channel; disable = unsubscribe + withdraw. All best-effort with
	// clear failure feedback.
	// P1-C：Web Push 开关。开启 = 权限 + 订阅 + 经 E2EE 通道上报；
	// 关闭 = 退订 + 撤回。失败给出明确反馈。
	const webPushCheckbox = $('#settings-web-push', settingsContent);
	on(webPushCheckbox, 'change', e => {
		const checked = e.target.checked;
		if (checked) {
			if (!isPushSupported()) {
				alert(t('settings.web_push_unsupported', 'Web Push is not supported in this browser (or the app is not served over HTTPS).'));
				e.target.checked = false;
				return
			}
			enablePush().then(() => {
				e.target.checked = true
			}).catch((err) => {
				e.target.checked = false;
				if (err && err.message === 'push-denied') {
					alert(t('settings.web_push_denied', 'Notification permission was denied. Please allow notifications in your browser settings.'))
				} else {
					alert(t('settings.web_push_failed', 'Could not enable offline push. Please try again.'))
				}
			})
		} else {
			disablePush().catch(() => { /* best-effort */ })
		}
	});
	// P3: dark mode select (auto/light/dark)
	// P3：深色模式选择
	on(darkModeSelect, 'change', e => {
		settings.darkMode = e.target.value;
		saveSettings(settings);
		applySettings(settings)
	});
	// P3: local encrypted history toggle.
	// Toggling ON derives memory-only keys for existing rooms (via event);
	// toggling OFF simply stops appending — stored ciphertext stays until
	// the user clicks Clear (explicit, visible, no silent deletion).
	// P3：本地加密历史开关。开启时广播事件为已加入房间补派生密钥（仅内存）；
	// 关闭时只停止追加，已存密文保留到用户显式点"清除"。
	on(localHistoryCheckbox, 'change', e => {
		settings.localHistory = e.target.checked;
		saveSettings(settings);
		applySettings(settings);
		window.dispatchEvent(new CustomEvent('localHistorySettingChanged', {
			detail: {
				enabled: settings.localHistory
			}
		}))
	});
	// P3: one-click clear of all local encrypted history
	// P3：一键清除所有本地加密历史
	on(clearHistoryBtn, 'click', () => {
		const removed = clearAllLocalHistory();
		window.addSystemMsg && window.addSystemMsg(t('system.history_cleared', 'Local message history cleared (encrypted blobs removed).') + ` [${removed}]`)
	});
	// v1.1.0 #10: send-original toggle (default off = auto compress + EXIF strip)
	const sendOriginalCheckbox = $('#settings-send-original', settingsContent);
	on(sendOriginalCheckbox, 'change', e => {
		settings.sendOriginal = !!e.target.checked;
		saveSettings(settings);
	});
	// v1.1.0 #5: per-room mute toggle (front-end notifications only)
	const muteRoomCheckbox = $('#settings-mute-room', settingsContent);
	on(muteRoomCheckbox, 'change', e => {
		const hash = currentRoomHash();
		if (!hash) {
			e.target.checked = false;
			return;
		}
		try {
			if (e.target.checked) localStorage.setItem('jmlt_mute_' + hash, '1');
			else localStorage.removeItem('jmlt_mute_' + hash);
		} catch (_e) { /* storage unavailable */ }
	});
	// v1.1.0 #2: panic wipe (double-confirmed inside panicWipeWithConfirm)
	const panicWipeBtn = $('#settings-panic-wipe', settingsContent);
	on(panicWipeBtn, 'click', () => {
		panicWipeWithConfirm();
	});
	// P1-D: desktop-shell server URL (localhost-bundled client → remote worker).
	// Validation: empty (revert to same-origin) or a valid https URL. Reload
	// applies it because the WS address is computed at boot.
	// P1-D：桌面壳服务器地址。校验：留空（回到同源）或合法 https 地址；
	// 保存后刷新页面使 WS 地址生效。
	const serverUrlInput = $('#settings-server-url', settingsContent);
	const serverUrlSaveBtn = $('#settings-server-url-save', settingsContent);
	on(serverUrlSaveBtn, 'click', () => {
		const raw = (serverUrlInput ? serverUrlInput.value : '').trim();
		if (raw === '') {
			try { localStorage.removeItem('jmlt_server_url'); } catch (_e) { /* ignore */ }
			window.location.reload();
			return
		}
		let ok = false;
		try {
			const parsed = new URL(raw);
			ok = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
		} catch (_e) { ok = false }
		if (!ok) {
			alert(t('settings.server_url_invalid', 'Please enter a valid https:// URL (or leave empty to use the current server).'));
			return
		}
		try { localStorage.setItem('jmlt_server_url', raw); } catch (_e) { /* ignore */ }
		window.location.reload();
	});
	// Theme selection event handlers
	// 主题选择事件处理
	const themeSelector = $('#theme-selector', settingsContent);
	if (themeSelector) {
		// Custom scrolling functionality
		// 自定义滚动功能
		let isDragging = false;
		let startX = 0;
		let scrollLeft = 0;

		// Mouse wheel scrolling (vertical -> horizontal)
		// 鼠标滚轮滚动（垂直转水平）
		on(themeSelector, 'wheel', e => {
			e.preventDefault();
			const scrollAmount = e.deltaY * 0.5; // Adjust scroll sensitivity
			themeSelector.scrollLeft += scrollAmount;
		});
		// Mouse drag scrolling
		// 鼠标拖拽滚动
		let dragStartTime = 0;
		let hasDragged = false;
		
		on(themeSelector, 'mousedown', e => {
			isDragging = true;
			hasDragged = false;
			dragStartTime = Date.now();
			startX = e.pageX - themeSelector.offsetLeft;
			scrollLeft = themeSelector.scrollLeft;
			themeSelector.classList.add('dragging');
			e.preventDefault(); // Prevent text selection
		});
		on(document, 'mousemove', e => {
			if (!isDragging) return;
			e.preventDefault();
			const x = e.pageX - themeSelector.offsetLeft;
			const walk = (x - startX) * 2; // Scroll speed multiplier
			const moved = Math.abs(walk);
			
			// If moved more than 5px, consider it a drag
			if (moved > 5) {
				hasDragged = true;
			}
			
			themeSelector.scrollLeft = scrollLeft - walk;
		});

		on(document, 'mouseup', () => {
			if (isDragging) {
				isDragging = false;
				themeSelector.classList.remove('dragging');
			}
		});
		// Touch support for mobile
		// 移动端触摸支持
		let touchStartX = 0;
		let touchScrollLeft = 0;
		let touchStartTime = 0;
		let touchHasMoved = false;

		on(themeSelector, 'touchstart', e => {
			touchStartX = e.touches[0].clientX;
			touchScrollLeft = themeSelector.scrollLeft;
			touchStartTime = Date.now();
			touchHasMoved = false;
		});

		on(themeSelector, 'touchmove', e => {
			e.preventDefault();
			const touchX = e.touches[0].clientX;
			const walk = (touchStartX - touchX) * 1.5; // Touch scroll sensitivity
			
			// If moved more than 10px, consider it a swipe
			if (Math.abs(walk) > 10) {
				touchHasMoved = true;
			}
			
			themeSelector.scrollLeft = touchScrollLeft + walk;
		});

		// Handle touch end for theme selection
		// 处理触摸结束的主题选择
		on(themeSelector, 'touchend', e => {
			// If user swiped, don't trigger theme selection
			// 如果用户滑动过，不触发主题选择
			if (touchHasMoved) {
				touchHasMoved = false;
				return;
			}
			
			// Check if it was a quick tap
			// 检查是否是快速点击
			const tapDuration = Date.now() - touchStartTime;
			if (tapDuration > 300) {
				return;
			}
			
			const themeItem = e.target.closest('.theme-item');
			if (themeItem) {
				const themeId = themeItem.dataset.themeId;
				if (themeId && themeId !== settings.theme) {
					// Update active state
					$$('.theme-item', themeSelector).forEach(item => {
						item.classList.remove('active');
					});
					themeItem.classList.add('active');
					
					// Apply theme and save settings
					settings.theme = themeId;
					applyTheme(themeId);
					saveSettings(settings);
				}
			}
		});
		// Theme selection click handler
		// 主题选择点击处理器
		on(themeSelector, 'click', e => {
			// If user just dragged, don't trigger theme selection
			// 如果用户刚刚拖拽过，不触发主题选择
			if (hasDragged) {
				hasDragged = false;
				return;
			}
			
			// Also check if it was a quick click (less than 200ms and minimal movement)
			// 同时检查是否是快速点击（少于200ms且移动很少）
			const clickDuration = Date.now() - dragStartTime;
			if (clickDuration > 200) {
				return;
			}
			
			const themeItem = e.target.closest('.theme-item');
			if (themeItem) {
				const themeId = themeItem.dataset.themeId;
				if (themeId && themeId !== settings.theme) {
					// Update active state
					$$('.theme-item', themeSelector).forEach(item => {
						item.classList.remove('active');
					});
					themeItem.classList.add('active');
					
					// Apply theme and save settings
					settings.theme = themeId;
					applyTheme(themeId);
					saveSettings(settings);
				}
			}
		});
	}
}

// Check if device is mobile
function isMobile() {
	return window.innerWidth <= 768;
}

// Open the settings panel
// 打开设置面板
function openSettingsPanel() {
	const settingsSidebar = $id('settings-sidebar');
	const sidebar = $id('sidebar');
	const sidebarMask = $id('mobile-sidebar-mask');
	
	if (!settingsSidebar || !sidebar) return;
	
	if (isMobile()) {
		// Mobile: hide main sidebar and show settings sidebar with mask
		sidebar.classList.remove('mobile-open');
		settingsSidebar.style.display = 'flex';
		// Force reflow then add animation class
		settingsSidebar.offsetHeight;
		settingsSidebar.classList.add('mobile-open');
		if (sidebarMask) {
			sidebarMask.classList.add('active');
		}	} else {
		// Desktop: show settings sidebar as overlay with slide animation
		settingsSidebar.style.display = 'flex';
		// Force reflow then slide in
		settingsSidebar.offsetHeight;
		settingsSidebar.classList.add('open');
		// Keep main sidebar visible - settings sidebar is an overlay
	}
	
	// Setup settings content
	setupSettingsPanel();
}

// Close the settings panel
// 关闭设置面板
function closeSettingsPanel() {
	const settingsSidebar = $id('settings-sidebar');
	const sidebarMask = $id('mobile-sidebar-mask'); // mobile-sidebar-mask is used for settings on mobile

	if (!settingsSidebar) return;

	const animationEnded = () => {
		settingsSidebar.style.display = 'none';
		settingsSidebar.removeEventListener('transitionend', animationEnded);
	};

	if (isMobile()) {
		settingsSidebar.classList.remove('mobile-open');
		if (sidebarMask) {
			sidebarMask.classList.remove('active');
		}
		// Listen for transition end to set display none
		settingsSidebar.addEventListener('transitionend', animationEnded);
		// Fallback if transitionend doesn't fire (e.g., if no transition is defined or display:none is set too early by other means)
		setTimeout(() => {
			if (!settingsSidebar.classList.contains('mobile-open')) { // check if it wasn't reopened
				settingsSidebar.style.display = 'none';
			}
		}, 350); // Slightly longer than CSS transition
	} else {
		settingsSidebar.classList.remove('open');
		// Listen for transition end to set display none
		settingsSidebar.addEventListener('transitionend', animationEnded);
		// Fallback
		setTimeout(() => {
			if (!settingsSidebar.classList.contains('open')) { // check if it wasn't reopened
				settingsSidebar.style.display = 'none';
			}
		}, 350);
	}
}

// Initialize settings on page load
// 页面加载时初始化设置
function initSettings() {
	const settings = loadSettings();
	applySettings(settings);
	
	// Apply theme from settings
	// 从设置中应用主题
	if (settings.theme) {
		applyTheme(settings.theme);
	}
	
	// Listen for language change events to update UI
	// 监听语言变更事件以更新UI
	window.addEventListener('languageChange', () => {
		// Update settings title if settings panel is open
		// 如果设置面板已打开，更新设置标题
		const settingsTitle = $id('settings-title');
		if (settingsTitle) {
			settingsTitle.textContent = t('settings.title', 'Settings');
		}
	});
}

// Maximum notification text length
// 通知文本最大长度
const MAX_NOTIFY_TEXT_LEN = 100;

// Truncate text for notifications
// 截断通知文本
function truncateText(text) {
	return text.length > MAX_NOTIFY_TEXT_LEN ? text.slice(0, MAX_NOTIFY_TEXT_LEN) + '...' : text
}

// Play sound notification
// 播放声音通知
function playSoundNotification() {
	try {
		const ctx = new(window.AudioContext || window.webkitAudioContext)();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = 1000;
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start();
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
		setTimeout(() => {
			osc.stop();
			ctx.close()
		}, 600)
	} catch (e) {
		console.error('Sound notification failed', e)
	}
}

// Show desktop notification
// 显示桌面通知
function showDesktopNotification(roomName, text, msgType, sender) {
	if (!('Notification' in window) || Notification.permission !== 'granted') return;
	let body;
	const senderPrefix = sender ? `${sender}:` : '';	if (msgType === 'image' || msgType === 'private image') {
		body = `${senderPrefix}${t('notification.image', '[image]')}`;
		if (msgType === 'private image') {
			body = `${t('notification.private', '(Private)')}${body}`
		}
	} else if (msgType === 'text' || msgType === 'private text') {
		body = `${senderPrefix}${truncateText(text)}`;
		if (msgType === 'private text') {
			body = `${t('notification.private', '(Private)')}${body}`
		}
	} else {
		body = truncateText(text)
	}
	new Notification(`#${roomName}`, {
		body
	})
}

// Notify message entry point
// 通知消息主入口
// v1.1.0 #5: roomHash (5th arg, optional) keys the per-room mute flag
// `jmlt_mute_<hash>` in localStorage. Frontend-only honesty boundary: mutes
// desktop notifications and sounds on THIS device while the app is open; Web
// Push wake-ups are out of scope (worker-driven, payload-free).
// v1.1.0 #5：第 5 参 roomHash（可选）对应 localStorage 的 `jmlt_mute_<hash>`
// 房间静音标志。诚实边界：只静音本设备前台时的桌面通知/声音；Web Push 唤醒
// 由 worker 驱动（无载荷），不在此范围。
export function notifyMessage(roomName, msgType, text, sender, roomHash) {
	if (roomHash) {
		try {
			if (localStorage.getItem('jmlt_mute_' + roomHash) === '1') return;
		} catch (_e) { /* storage unavailable — don't mute */ }
	}
	const settings = loadSettings();
	if (settings.notify) {
		showDesktopNotification(roomName, text, msgType, sender)
	} else if (settings.sound) {
		playSoundNotification()
	}
}
export {
	openSettingsPanel,
	closeSettingsPanel,
	initSettings
};
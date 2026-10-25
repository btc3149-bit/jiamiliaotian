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
// v1.3.0 #6: local room metadata (alias/group/pinned)
import { roomHashOf, getRoomMeta, setRoomMeta } from './util.roomMeta.js';
// v1.3.0 #7: encrypted chat archive (.jmlt)
import {
	collectExportMessages,
	serializeArchive,
	encryptArchive,
	decryptArchive,
	mergeArchiveMessages
} from './util.exportArchive.js';
// v1.4.0 #3: app lock (WebAuthn local lock)
import { enableAppLock, disableAppLock, lockNow, isAppLockSupported, isAppLockEnabled } from './util.applock.js';
// v1.4.0 #14: room credential migration (QR + .jmltk file)
import { encryptMigration, buildMigrationPayload, decryptMigration, showMigrationModal } from './util.keyExport.js';
// v1.3.0 #6/#7 helpers for the current-room section
function currentRoom() {
	try {
		return (window.roomsData && window.roomsData[window.activeRoomIndex]) || null;
	} catch (_e) { return null }
}
function refreshRoomViews() {
	if (typeof window.__jmltRenderRooms === 'function') window.__jmltRenderRooms();
	if (typeof window.__jmltRenderChat === 'function') window.__jmltRenderChat()
}
// Default settings
// 默认设置
const DEFAULT_SETTINGS = {
	notify: false,
	sound: false,
	theme: 'theme1',
	darkMode: 'auto', // 'auto' 跟随系统 | 'light' | 'dark'
	localHistory: false, // 本地加密消息历史（可选，默认关闭）
	sendOriginal: false, // v1.1.0 #10：发送原图（默认关 = 自动压缩 + 剥 EXIF）
	appLock: false, // v1.4.0 #3：应用锁（默认关；凭据 id 存独立键 jmlt_applock_cred）
	presence: '', // v1.4.0 #12：在线状态声明（'' = 不共享，默认关）
	p2pCalls: false, // v1.5.0 #16：P2P 通话（默认关——对方可见 IP，须显式开启）
	stunServers: '' // v1.5.0 #16：自填 STUN（默认空 = 仅局域网/同网）
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
		sendOriginal,
		appLock,
		presence,
		p2pCalls,
		stunServers
	} = settings;
	localStorage.setItem('settings', JSON.stringify({
		notify,
		sound,
		theme,
		language,
		darkMode,
		localHistory,
		sendOriginal,
		appLock,
		presence,
		p2pCalls,
		stunServers
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
					<div>${t('settings.applock', 'App Lock (WebAuthn)')}</div>
					<div class="settings-item-desc">${t('settings.applock_desc', 'Lock the screen with this device\'s platform authenticator (fingerprint / face / Windows Hello) after 5 minutes in the background, or lock manually below. The credential never leaves this device. Honest limits: this is an anti-shoulder-surfing guard — it does NOT resist a technical user (DevTools) or forensics.')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-applock" ${isAppLockEnabled() ? 'checked' : ''} ${isAppLockSupported() ? '' : 'disabled'}>
					<span class="slider"></span>
				</label>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.applock_now', 'Lock Now')}</div>
					<div class="settings-item-desc">${t('settings.applock_now_desc', 'Immediately lock the screen (requires App Lock to be enabled).')}</div>
				</div>
				<button type="button" id="settings-applock-lock" class="settings-danger-btn" style="background:#357ae8;color:#fff">${t('settings.applock_now_btn', 'Lock')}</button>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.presence', 'Share My Status')}</div>
					<div class="settings-item-desc">${t('settings.presence_desc', 'Optionally broadcast a self-declared status (online / away / busy) to room members as an encrypted signal. OFF by default — when off, nothing is ever sent. Switching off stops future announcements; an already-shown status remains until you leave.')}</div>
				</div>
				<div class="language-selector">
					<select id="settings-presence" class="language-select">
						<option value="" ${!settings.presence ? 'selected' : ''}>${t('presence.off', 'Do not share (default)')}</option>
						<option value="online" ${settings.presence === 'online' ? 'selected' : ''}>${t('presence.online', '🟢 Online')}</option>
						<option value="away" ${settings.presence === 'away' ? 'selected' : ''}>${t('presence.away', '🌙 Away')}</option>
						<option value="busy" ${settings.presence === 'busy' ? 'selected' : ''}>${t('presence.busy', '⛔ Busy')}</option>
					</select>
				</div>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.p2p_calls', 'Allow P2P Calls (peer sees your IP)')}</div>
					<div class="settings-item-desc">${t('settings.p2p_calls_desc', 'Enable 1-to-1 audio/video calls with your private-chat partner. Media is peer-to-peer (DTLS-SRTP enforced by the browser), which means the other party can see your IP address — that is the nature of direct connections. OFF by default; no call signal is ever sent or accepted while off. Signaling itself always stays inside the end-to-end encrypted channel.')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-p2p-calls" ${settings.p2pCalls ? 'checked' : ''}>
					<span class="slider"></span>
				</label>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.stun_servers', 'STUN Servers (optional)')}</div>
					<div class="settings-item-desc">${t('settings.stun_servers_desc', 'Only needed across different networks. Comma-separated stun:host[:port] entries, at most 4. Nothing is built in — you choose your own servers (they can see connection attempts, not content). Empty = LAN/same-network only.')}</div>
				</div>
				<div class="language-selector">
					<input type="text" id="settings-stun" class="language-select" style="width:220px" placeholder="stun:stun.example.net:3478" value="${escapeHTMLServerUrl(settings.stunServers || '')}">
				</div>
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
			<div class="settings-section-title">${t('settings.current_room', 'Current Room')}</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.room_alias', 'Room Alias (local only)')}</div>
					<div class="settings-item-desc">${t('settings.room_alias_desc', 'Only changes the name YOU see. Room identity is password + hash — renaming never changes any security property.')}</div>
				</div>
				<div class="language-selector">
					<input type="text" id="settings-room-alias" class="language-select" style="width:220px" maxlength="64" value="${escapeHTMLServerUrl(currentRoom() ? (getRoomMeta(roomHashOf(currentRoom().roomName || '')).alias || '') : '')}">
				</div>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.room_group', 'Group Tag (local only)')}</div>
					<div class="settings-item-desc">${t('settings.room_group_desc', 'A small badge shown next to the room name in your list.')}</div>
				</div>
				<div class="language-selector">
					<input type="text" id="settings-room-group" class="language-select" style="width:220px" maxlength="32" value="${escapeHTMLServerUrl(currentRoom() ? (getRoomMeta(roomHashOf(currentRoom().roomName || '')).group || '') : '')}">
				</div>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.room_pin', 'Pin This Room')}</div>
					<div class="settings-item-desc">${t('settings.room_pin_desc', 'Pinned rooms float to the top of your list.')}</div>
				</div>
				<label class="switch">
					<input type="checkbox" id="settings-room-pin" ${(currentRoom() && getRoomMeta(roomHashOf(currentRoom().roomName || '')).pinned) ? 'checked' : ''}>
					<span class="slider"></span>
				</label>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.export_archive', 'Export Encrypted Archive')}</div>
					<div class="settings-item-desc">${t('settings.export_archive_desc', 'Downloads a password-encrypted .jmlt file of this room\'s messages. Encrypted locally with the room password (AES-256-GCM). Anyone with the file AND the room password can read it — guard both.')}</div>
				</div>
				<button type="button" id="settings-export-archive" class="settings-danger-btn" style="background:#357ae8;color:#fff">${t('settings.export_archive_btn', 'Export')}</button>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.import_archive', 'Import Encrypted Archive')}</div>
					<div class="settings-item-desc">${t('settings.import_archive_desc', 'Merge a .jmlt archive into this room. It must have been exported from the SAME room (fingerprint is verified). Messages are deduplicated by id.')}</div>
				</div>
				<button type="button" id="settings-import-archive" class="settings-danger-btn" style="background:#357ae8;color:#fff">${t('settings.import_archive_btn', 'Choose File…')}</button>
				<input type="file" id="settings-import-archive-file" accept=".jmlt,application/octet-stream" style="display:none">
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.export_creds', 'Export Room Credentials (Migration)')}</div>
					<div class="settings-item-desc">${t('settings.export_creds_desc', 'Creates a QR code / file containing this room\'s name + password, encrypted with a one-time key you choose. Valid for 10 minutes. The server pin is NOT migrated — the new device re-establishes trust on first connect (by design, so trust is never copied).')}</div>
				</div>
				<button type="button" id="settings-export-creds" class="settings-danger-btn" style="background:#357ae8;color:#fff">${t('settings.export_creds_btn', 'Export…')}</button>
			</div>
			<div class="settings-item">
				<div class="settings-item-label">
					<div>${t('settings.import_creds', 'Import Room Credentials')}</div>
					<div class="settings-item-desc">${t('settings.import_creds_desc', 'Open a .jmltk migration file (or scan the QR on the login screen). You need the one-time key that was used to create it. Files expire after 10 minutes.')}</div>
				</div>
				<button type="button" id="settings-import-creds" class="settings-danger-btn" style="background:#357ae8;color:#fff">${t('settings.import_creds_btn', 'Choose File…')}</button>
				<input type="file" id="settings-import-creds-file" accept=".jmltk,application/octet-stream" style="display:none">
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
	// ==================== v1.4.0 #3: app lock ====================
	const appLockCheckbox = $('#settings-applock', settingsContent);
	on(appLockCheckbox, 'change', e => {
		if (e.target.checked) {
			if (!isAppLockSupported()) {
				alert(t('settings.applock_unsupported', 'App Lock requires a platform authenticator (fingerprint / face / Windows Hello). Not available in this browser.'));
				e.target.checked = false;
				return
			}
			enableAppLock().then(() => {
				settings.appLock = true;
				saveSettings(settings);
			}).catch(() => {
				e.target.checked = false;
				alert(t('settings.applock_failed', 'Could not register the app lock credential.'))
			})
		} else {
			disableAppLock();
			settings.appLock = false;
			saveSettings(settings)
		}
	});
	const appLockNowBtn = $('#settings-applock-lock', settingsContent);
	on(appLockNowBtn, 'click', () => {
		if (!lockNow()) {
			alert(t('settings.applock_need_enable', 'Enable App Lock first.'))
		}
	});
	// ==================== v1.4.0 #12: presence selector ====================
	const presenceSelect = $('#settings-presence', settingsContent);
	on(presenceSelect, 'change', e => {
		const val = (e.target.value === 'online' || e.target.value === 'away' || e.target.value === 'busy') ? e.target.value : '';
		settings.presence = val;
		saveSettings(settings);
		// room.js listens and (re-)broadcasts to every joined room / resets flags.
		// room.js 监听该事件并向所有已加入房间（重）广播/复位标记。
		window.dispatchEvent(new CustomEvent('jmltPresenceChanged', { detail: { status: val } }))
	});
	// ==================== v1.5.0 #16: P2P calls + STUN ====================
	const p2pCallsCheckbox = $('#settings-p2p-calls', settingsContent);
	on(p2pCallsCheckbox, 'change', e => {
		settings.p2pCalls = !!e.target.checked;
		saveSettings(settings)
	});
	const stunInput = $('#settings-stun', settingsContent);
	on(stunInput, 'change', () => {
		settings.stunServers = (stunInput ? stunInput.value : '').trim();
		saveSettings(settings)
	});
	// ==================== v1.4.0 #14: credential migration ====================
	on($('#settings-export-creds', settingsContent), 'click', async () => {
		const rd = currentRoom();
		if (!rd || !rd.roomName) {
			alert(t('settings.export_no_room', 'Join a room first.'));
			return
		}
		const key = window.prompt(t('settings.export_creds_key', 'Choose a one-time migration key (to encrypt the credentials):') || '');
		if (!key) return;
		try {
			const payload = buildMigrationPayload(rd.roomName, rd.password || '', rd.myUserName || '', Date.now());
			const bytes = await encryptMigration(payload, key);
			showMigrationModal(bytes);
			window.addSystemMsg && window.addSystemMsg(t('settings.export_creds_done', 'Credentials exported — scan the QR on the new device within 10 minutes.'), true)
		} catch (err) {
			window.addSystemMsg && window.addSystemMsg(t('settings.export_failed', 'Export failed: ') + (err && err.message || err), true)
		}
	});
	const credsFileInput = $('#settings-import-creds-file', settingsContent);
	on($('#settings-import-creds', settingsContent), 'click', () => {
		if (credsFileInput) credsFileInput.click()
	});
	on(credsFileInput, 'change', async () => {
		const file = credsFileInput && credsFileInput.files && credsFileInput.files[0];
		if (credsFileInput) credsFileInput.value = '';
		if (!file) return;
		const key = window.prompt(t('settings.import_creds_key', 'Migration key (to decrypt the credentials):') || '');
		if (!key) return;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const data = await decryptMigration(bytes, key);
			if (typeof window.__jmltOpenLoginPrefill === 'function') {
				window.__jmltOpenLoginPrefill(data)
			}
			window.addSystemMsg && window.addSystemMsg(t('settings.import_creds_done', 'Room credentials imported — review and press ENTER to join.'), true)
		} catch (err) {
			const expired = err && err.message === 'expired';
			window.addSystemMsg && window.addSystemMsg(expired
				? t('settings.import_creds_expired', 'Import failed — the migration expired (valid for 10 minutes). Export again.')
				: t('settings.import_creds_failed', 'Import failed — wrong key or corrupted file.'), true)
		}
	});
	// ==================== v1.3.0 #6: room management ====================
	const roomAliasInput = $('#settings-room-alias', settingsContent);
	const roomGroupInput = $('#settings-room-group', settingsContent);
	const roomPinSwitch = $('#settings-room-pin', settingsContent);
	function saveRoomMetaFromUi() {
		const rd = currentRoom();
		if (!rd) return;
		const hash = roomHashOf(rd.roomName || '');
		setRoomMeta(hash, {
			alias: roomAliasInput ? roomAliasInput.value : '',
			group: roomGroupInput ? roomGroupInput.value : '',
			pinned: roomPinSwitch ? roomPinSwitch.checked : false
		});
		refreshRoomViews()
	}
	on(roomAliasInput, 'change', saveRoomMetaFromUi);
	on(roomGroupInput, 'change', saveRoomMetaFromUi);
	on(roomPinSwitch, 'change', saveRoomMetaFromUi);
	// ==================== v1.3.0 #7: encrypted archive ====================
	function localTimestamp() {
		const d = new Date();
		const p = (n) => String(n).padStart(2, '0');
		return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes())
	}
	on($('#settings-export-archive', settingsContent), 'click', async () => {
		const rd = currentRoom();
		if (!rd || !rd.chat || !rd.chat.credentials) {
			alert(t('settings.export_no_room', 'Join a room first.'));
			return
		}
		const password = rd.password || window.prompt(t('settings.export_ask_password', 'Room password (for encryption):') || '');
		if (!password) return;
		const fp = rd.chat.credentials.channel;
		try {
			const { msgs, skipped } = collectExportMessages(rd);
			const json = serializeArchive(fp, msgs, skipped);
			const bytes = await encryptArchive(json, password, fp);
			const blob = new Blob([bytes], { type: 'application/octet-stream' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = 'jiamiliaotian-chat-' + String(fp).slice(0, 12) + '-' + localTimestamp() + '.jmlt';
			document.body.appendChild(a);
			a.click();
			setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000);
			window.addSystemMsg && window.addSystemMsg(t('settings.export_done', 'Archive exported ({n} messages, {s} file transfer(s) skipped). Guard the file — it is only as safe as where you keep it.').replace('{n}', String(msgs.length)).replace('{s}', String(skipped)), true)
		} catch (err) {
			window.addSystemMsg && window.addSystemMsg(t('settings.export_failed', 'Export failed: ') + (err && err.message || err), true)
		}
	});
	const importFileInput = $('#settings-import-archive-file', settingsContent);
	on($('#settings-import-archive', settingsContent), 'click', () => {
		const rd = currentRoom();
		if (!rd || !rd.chat || !rd.chat.credentials) {
			alert(t('settings.export_no_room', 'Join a room first.'));
			return
		}
		if (importFileInput) importFileInput.click()
	});
	on(importFileInput, 'change', async () => {
		const file = importFileInput && importFileInput.files && importFileInput.files[0];
		if (importFileInput) importFileInput.value = '';
		if (!file) return;
		const rd = currentRoom();
		if (!rd || !rd.chat || !rd.chat.credentials) return;
		const password = window.prompt(t('settings.import_ask_password', 'Room password (to decrypt the archive):') || '');
		if (!password) return;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const payload = await decryptArchive(bytes, password, rd.chat.credentials.channel);
			const { toAppend, dup } = mergeArchiveMessages(rd.messages, payload.msgs);
			for (const m of toAppend) {
				const entry = m.k === 's'
					? { type: 'system', text: m.x, timestamp: m.ts }
					: {
						type: m.k, text: m.x, msgType: m.t, userName: m.u, timestamp: m.ts,
						id: m.id, quote: m.q, ttl: m.ttl, edited: m.e,
						reactions: null, mentions: null, mentionsMe: false,
						deleted: false, burned: false, imported: true
					};
				rd.messages.push(entry);
				// opt-in encrypted local history (no-op unless enabled)
				try {
					window.__jmltAppendLocalHistory && window.__jmltAppendLocalHistory(rd, entry)
				} catch (_e) { /* best-effort */ }
			}
			// chronological order across merged devices
			rd.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
			refreshRoomViews();
			window.addSystemMsg && window.addSystemMsg(t('settings.import_done', 'Imported {n} message(s) ({d} duplicate(s) skipped).').replace('{n}', String(toAppend.length)).replace('{d}', String(dup)), true)
		} catch (err) {
			window.addSystemMsg && window.addSystemMsg(t('settings.import_failed', 'Import failed — wrong password, wrong room, or corrupted file.'), true)
		}
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
		// v1.8.3: reloads drop the in-memory session (credentials never touch
		// disk by RULES), so the user lands back on the login page. Only
		// reload when the value ACTUALLY changed — clicking "apply" with an
		// unchanged value used to look like a random logout.
		// v1.8.3：刷新会丢掉内存态会话（凭据按 RULES 永不落盘），用户会被
		// 踢回登录页。因此只在值真正变化时才刷新——值没变时点「应用」
		// 之前表现得像莫名掉登录。
		let storedRaw = '';
		try { storedRaw = localStorage.getItem('jmlt_server_url') || ''; } catch (_e) { /* ignore */ }
		if (raw === storedRaw) {
			window.addSystemMsg && window.addSystemMsg(t('settings.server_url_unchanged', 'Server URL unchanged — settings are saved automatically, nothing to reload.'), true);
			return
		}
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
	} else if (msgType === 'voice' || msgType === 'private voice') {
		// v1.2.0 #9: voice — never leak duration metadata granularity beyond a
		// generic marker; keep the notification content-free like images.
		// v1.2.0 #9：语音通知只给通用标记，不带任何内容。
		body = `${senderPrefix}${t('notification.voice', '[voice]')}`;
		if (msgType === 'private voice') {
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
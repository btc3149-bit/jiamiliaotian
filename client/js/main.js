// 导入 NodeCrypt 模块（加密功能模块）
// Import the NodeCrypt module (used for encryption)
import './NodeCrypt.js';

// 从 util.file.js 中导入设置文件发送的函数
// Import setupFileSend function from util.file.js
import {
	setupFileSend,
	handleFileMessage,
	downloadFile
} from './util.file.js';

// P2: 拖拽文件直投上传模态框 / Drop files straight into the upload modal
import {
	handleExternalDrop
} from './util.fileUpload.js';

// 从 util.image.js 中导入图片处理功能
// Import image processing functions from util.image.js
import {
	setupImagePaste
} from './util.image.js';

// 从 util.emoji.js 中导入设置表情选择器的函数
// Import setupEmojiPicker function from util.emoji.js
import {
	setupEmojiPicker
} from './util.emoji.js';

// 从 util.settings.js 中导入设置面板的功能函数
// Import functions for settings panel from util.settings.js
import {
	openSettingsPanel,   // 打开设置面板 / Open settings panel
	closeSettingsPanel,  // 关闭设置面板 / Close settings panel
	initSettings,         // 初始化设置 / Initialize settings
	notifyMessage         // 通知信息提示 / Display notification message
} from './util.settings.js';
import { t, updateStaticTexts } from './util.i18n.js';

// P1-A: PWA 支持（SW 注册 + 安装提示捕获）
import {
	initPWA
} from './util.pwa.js';

// 从 util.theme.js 中导入主题功能函数
// Import theme functions from util.theme.js
import {
	initTheme            // 初始化主题 / Initialize theme
} from './util.theme.js';

// 从 util.dom.js 中导入常用 DOM 操作函数
// Import common DOM manipulation functions from util.dom.js
import {
	$,         // 简化的 document.querySelector / Simplified selector
	$id,       // document.getElementById 的简写 / Shortcut for getElementById
	removeClass // 移除类名 / Remove a CSS class
} from './util.dom.js';

// 从 room.js 中导入房间管理相关变量和函数
// Import room-related variables and functions from room.js
import {
	roomsData,         // 当前所有房间的数据 / Data of all rooms
	activeRoomIndex,   // 当前激活的房间索引 / Index of the active room
	joinRoom           // 加入房间的函数 / Function to join a room
} from './room.js';

// 从 chat.js 中导入聊天功能相关的函数
// Import chat-related functions from chat.js
import {
	addMsg,               // 添加普通消息到聊天窗口 / Add a normal message to chat
	addOtherMsg,          // 添加其他用户消息 / Add message from other users
	addSystemMsg,         // 添加系统消息 / Add a system message
	setupImagePreview,    // 设置图片预览功能 / Setup image preview
	setupInputPlaceholder, // 设置输入框的占位提示 / Setup placeholder for input box
	setupReactionsUI,     // 表情回应交互（事件委托）/ Reaction UI (event delegation)
	autoGrowInput,        // 自动调整输入框高度 / Auto adjust input height
	saveDraft,            // P2: 保存房间草稿 / Save per-room draft
	clearDraft,           // P2: 清除房间草稿 / Clear per-room draft
	getPendingReply,      // P1-B: 当前回复目标 / Current reply target
	clearPendingReply,    // P1-B: 清除回复目标 / Clear reply target
	getPendingEdit,       // P1-B: 当前编辑目标 / Current edit target
	clearPendingEdit,     // P1-B: 清除编辑目标 / Clear edit target
	getBurnTtl,           // P1-B: 当前焚毁定时 / Current burn timer
	applyEditLocal,       // P1-B: 本地应用编辑 / Apply edit locally
	setupBurnBtn,         // P1-B: 焚毁定时按钮 / Burn-timer toggle button
	setReadReceiptSender, // P1-C: 注入已读回执发送器 / Inject read-receipt sender
	queueReadReceipt,     // P1-C: 排队已读回执 / Queue a read receipt
	isWindowReading,      // P1-C: 窗口是否处于阅读状态 / Is window in reading state
	setupSearchUI,        // v1.1.0 #1: 本地历史搜索 / Local history search UI
	setupSelectModeUI     // v1.1.0 #4: 多选复制/转发 / Multi-select copy/forward UI
} from './chat.js';
// P1-C: Web Push 房间表访问器注入 / Web Push room-list accessor injection
import { registerRoomListAccessor } from './util.push.js';

// v1.1.0 #2: 恐慌清除（双确认）/ Panic wipe (double-confirmed)
import { panicWipeWithConfirm } from './util.panic.js';

// v1.2.0 #9: 语音消息（MediaRecorder → E2EE 内容层）/ Voice messages
import { createVoiceRecorder } from './util.voice.js';

// v1.2.0 #11: 离线发送队列 / Offline send queue
import { isRoomConnected, enqueueSend } from './util.sendQueue.js';

// v1.4.0 #3: 应用锁（WebAuthn 本地锁）/ App lock (WebAuthn local lock)
import { initAppLock } from './util.applock.js';

// v1.4.0 #14: 凭据迁移落地（#jmlt= fragment）/ credential migration landing
import { decryptMigration, parseMigrationText } from './util.keyExport.js';

// v1.5.0 #16: WebRTC 1v1 音视频通话 / WebRTC 1v1 audio/video calls
import { createCallManager } from './util.call.js';

// v1.3.0 #6/#7: 设置面板渲染钩子 / render hooks for the settings panel
import { renderRooms } from './room.js';
import { renderChatArea } from './chat.js';
import { appendLocalHistory } from './util.localHistory.js';

// 从 ui.js 中导入 UI 界面相关的功能
// Import user interface functions from ui.js
import {	renderUserList,       // 渲染用户列表 / Render user list
	renderMainHeader,     // 渲染主标题栏 / Render main header
	setupMoreBtnMenu,     // 设置更多按钮的下拉菜单 / Setup "more" button menu
	preventSpaceInput,    // 防止输入空格 / Prevent space input in form fields
	loginFormHandler,     // 登录表单提交处理器 / Login form handler
	openLoginModal,       // 打开登录窗口 / Open login modal
	setupTabs,            // 设置页面标签切换 / Setup tab switching
	autofillRoomPwd,      // 自动填充房间密码 / Autofill room password
	generateLoginForm,    // 生成登录表单HTML / Generate login form HTML
	initLoginForm,        // 初始化登录表单 / Initialize login form
	initFlipCard          // 初始化翻转卡片功能 / Initialize flip card functionality
} from './ui.js';

// P1-D: optional server override for desktop shells (Tauri bundles the web
// client as a local asset, so "same-origin" no longer points at the backend).
// Priority: ?server= URL param > settings panel value (localStorage) > same-origin.
// SECURITY: the override only changes which E2EE server the client talks to;
// all crypto stays client-side. Desktop shells must use https/wss.
// P1-D: 桌面壳（Tauri）的服务器地址覆盖——前端作为本地资源打包，"同源"不再
// 指向后端。优先级：?server= 参数 > 设置面板（localStorage）> 同源。
const serverUrlParam = (() => {
	try { return new URLSearchParams(window.location.search).get('server') || ''; } catch (_e) { return ''; }
})();
const serverUrlStored = (() => {
	try { return localStorage.getItem('jmlt_server_url') || ''; } catch (_e) { return ''; }
})();
const serverUrl = (serverUrlParam || serverUrlStored).trim().replace(/\/+$/, '');
window.JMLT_SERVER_URL = serverUrl;

// 设置全局配置参数
// Set global configuration parameters
window.config = {
	wsAddress: serverUrl
		? serverUrl.replace(/^http/i, 'ws') // http(s):// → ws(s):// / 桌面壳显式指定服务器
		: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`, // WebSocket 服务器地址 / WebSocket server address
	//wsAddress: `wss://crypt.works`,
	debug: false                      // SECURITY: 生产环境必须关闭调试（开启会把解密内容打进 console）/ Must stay off in production
};

// 在文档开始加载前就初始化语言设置，防止闪烁
// Initialize language settings before document starts loading
initSettings();
updateStaticTexts();

// 把一些函数挂载到 window 对象上供其他模块使用
// Expose functions to the global window object for accessibility
window.addSystemMsg = addSystemMsg;
window.addOtherMsg = addOtherMsg;
window.joinRoom = joinRoom;
window.notifyMessage = notifyMessage;
window.setupEmojiPicker = setupEmojiPicker;
window.handleFileMessage = handleFileMessage;
window.downloadFile = downloadFile;
// v1.3.0 #6/#7: settings panel lives in util.settings.js which cannot import
// the renderers without a cycle — expose hooks instead.
// v1.3.0 #6/#7：设置面板在 util.settings.js，直接导入渲染器会成环——改挂钩子。
window.__jmltRenderRooms = () => renderRooms(activeRoomIndex);
window.__jmltRenderChat = () => renderChatArea();
window.__jmltAppendLocalHistory = (rd, entry) => {
	try { appendLocalHistory(rd, entry) } catch (_e) { /* best-effort */ }
};

// v1.4.0 #14: prefill the login form with migrated credentials. Works both
// on the login page (fill the main form) and inside a room (open the join
// modal and fill it). Values are set directly — loginFormHandler reads .value.
// v1.4.0 #14：用迁移来的凭据预填登录表单。登录页填主表单；已在房间内则
// 打开加入弹窗并填充。直接赋值即可——loginFormHandler 读 .value。
function fillLoginFormFields(prefix, data) {
	const u = document.getElementById('userName' + prefix);
	const n = document.getElementById('roomName' + prefix);
	const p = document.getElementById('password' + prefix);
	if (n) { n.value = data.roomName || ''; n.readOnly = false; }
	if (p) { p.value = data.password || ''; p.readOnly = false; p.style.color = ''; p.style.background = ''; }
	if (u && data.username) u.value = data.username;
}
window.__jmltOpenLoginPrefill = (data) => {
	if (!data || !data.roomName) return;
	const loginContainer = $id('login-container');
	const onLoginPage = !!(loginContainer && loginContainer.style.display !== 'none');
	if (onLoginPage) {
		fillLoginFormFields('', data);
	} else {
		// inside a room — open the join modal and fill it there
		// 已在房间内——打开加入弹窗填充
		openLoginModal();
		fillLoginFormFields('-modal', data);
	}
};

// ==================== v1.5.0 #16: WebRTC call manager ====================
// 通话管理器装在 main.js（信令回调经 room.js 的 window 钩子转发进来）。
let callManager = null;
window.__jmltOnCallSignal = (r) => { if (callManager) callManager.handleSignal(r) };
window.__jmltOnCallPeerLeft = (clientId) => { if (callManager) callManager.handlePeerLeft(clientId) };
window.__jmltUpdateCallBtn = () => {
	const btn = document.querySelector('.chat-call-btn');
	if (!btn) return;
	const rd = roomsData[activeRoomIndex];
	btn.style.display = (rd && rd.privateChatTargetId) ? '' : 'none';
};

// 当 DOM 内容加载完成后执行初始化逻辑
// Run initialization logic when the DOM content is fully loaded
window.addEventListener('DOMContentLoaded', () => {
	// 移除预加载样式类，允许过渡效果
	// Remove preload class to allow transitions
	setTimeout(() => {
		document.body.classList.remove('preload');
	}, 300);
	
	// 初始化登录表单 / Initialize login form
	initLoginForm();

	const loginForm = $id('login-form');               // 登录表单 / Login form

	if (loginForm) {
		// 监听登录表单提交事件 / Listen to login form submission
		loginForm.addEventListener('submit', loginFormHandler(null))
	}

	const joinBtn = $('.join-room'); // 加入房间按钮 / Join room button
	if (joinBtn) {
		joinBtn.onclick = openLoginModal; // 点击打开登录窗口 / Click to open login modal
	}
	// 阻止用户输入用户名、房间名和密码时输入空格
	// Prevent space input for username, room name, and password fields
	preventSpaceInput($id('userName'));
	preventSpaceInput($id('roomName'));
	preventSpaceInput($id('password'));
	
	// 初始化翻转卡片功能 / Initialize flip card functionality
	initFlipCard();
	
	// 初始化辅助功能和界面设置
	// Initialize autofill, input placeholders, and menus
	autofillRoomPwd();	setupInputPlaceholder();
	setupReactionsUI();
	// v1.4.0 #3: app lock — background auto-lock (5 min) + pagehide lock
	initAppLock();
	// v1.4.0 #14: credential migration landing — a scanned QR opens the app
	// with #jmlt=<payload>. The fragment never reaches any server; prompt for
	// the one-time key, decrypt (10-minute TTL enforced), prefill, strip hash.
	// v1.4.0 #14：扫码落地——#jmlt=<载荷>。fragment 不经过任何服务器；
	// 询问一次性密钥 → 解密（强制 10 分钟有效期）→ 预填 → 清除 hash。
	if ((location.hash || '').indexOf('#jmlt=') === 0) {
		const raw = location.hash.slice('#jmlt='.length);
		try { history.replaceState(null, '', location.pathname); } catch (_e) { /* keep hash */ }
		const bytes = parseMigrationText('#jmlt=' + raw);
		if (bytes) {
			const key = window.prompt(t('settings.import_creds_key', 'Migration key (to decrypt the credentials):') || '');
			if (key) {
				decryptMigration(bytes, key).then((data) => {
					window.__jmltOpenLoginPrefill(data);
					addSystemMsg(t('migration.prefilled', 'Room credentials imported from migration link — review and press ENTER to join.'), true)
				}).catch((err) => {
					const expired = err && err.message === 'expired';
					addSystemMsg(expired
						? t('settings.import_creds_expired', 'Import failed — the migration expired (valid for 10 minutes). Export again.')
						: t('settings.import_creds_failed', 'Import failed — wrong key or corrupted file.'), true)
				})
			}
		}
	}
	setupBurnBtn(); // P1-B: burn-timer toggle in composer
	// v1.1.0 #1/#4: 本地搜索 + 多选（多选条由 setupSelectModeUI 挂载）
	setupSearchUI();
	setupSelectModeUI();
	// v1.2.0 #9: 语音消息。单击开始/再击停止发送，Esc 取消，60s 上限自动停。
	// 发送路径与图片一致：公共走 sendChannelMessage('voice')，私聊走加密信封。
	const voiceBtn = document.querySelector('.chat-voice-btn');
	if (voiceBtn) {
		const voiceRecorder = createVoiceRecorder({
			onState: (s) => {
				voiceBtn.classList.toggle('recording', s === 'recording');
				voiceBtn.textContent = s === 'recording' ? '⏹' : '🎤';
			},
			onVoice: (dur, audio) => {
				const rd = roomsData[activeRoomIndex];
				if (!rd || !rd.chat) return;
				const payload = { audio, dur };
				if (rd.privateChatTargetId) {
					const targetClient = rd.chat.channel[rd.privateChatTargetId];
					if (targetClient && targetClient.shared) {
						const clientMessagePayload = {
							a: 'm',
							t: 'voice_private',
							d: payload,
							id: rd.chat.genMessageId()
						};
						const encryptedClientMessage = rd.chat.encryptClientMessage(clientMessagePayload, targetClient.shared);
						const serverRelayPayload = {
							a: 'c',
							p: encryptedClientMessage,
							c: rd.privateChatTargetId
						};
						const encryptedMessageForServer = rd.chat.encryptServerMessage(serverRelayPayload, rd.chat.serverShared);
						rd.chat.sendMessage(encryptedMessageForServer);
						addMsg(payload, false, 'voice_private', null, { id: clientMessagePayload.id });
					} else {
						addSystemMsg(`${t('system.private_message_failed', 'Cannot send private message to')} ${rd.privateChatTargetName}. ${t('system.user_not_connected', 'User might not be fully connected.')}`)
					}
				} else {
					const mid = rd.chat.sendChannelMessage('voice', payload);
					addMsg(payload, false, 'voice', null, { id: typeof mid === 'string' ? mid : null });
				}
			},
			onError: (kind) => {
				addSystemMsg(t('system.voice_failed', 'Voice recording unavailable ({reason}).').replace('{reason}', kind), true)
			}
		});
		voiceBtn.addEventListener('click', () => voiceRecorder.toggle());
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && voiceRecorder.state === 'recording') {
				e.stopPropagation();
				voiceRecorder.cancel()
			}
		});
	}
	// v1.5.0 #16: call manager + composer 📞 button (visible only with a
	// private-chat target; the button itself does the settings gate check).
	// v1.5.0 #16：通话管理器 + 输入区 📞 按钮（仅私聊对象时可见；
	// 设置开关的校验在 startOutgoing 内做）。
	callManager = createCallManager({
		getRoom: () => roomsData[activeRoomIndex],
		addSystem: (text, warn) => addSystemMsg(text, warn)
	});
	const callBtn = document.querySelector('.chat-call-btn');
	if (callBtn) {
		callBtn.addEventListener('click', () => callManager.startOutgoing());
	}
	setupMoreBtnMenu();
	// P1-C: give util.push.js read access to the live room list (injected to
	// avoid a circular module import with room.js)
	// P1-C: 向 util.push.js 注入房间表访问器（避免与 room.js 循环导入）
	registerRoomListAccessor(() => roomsData);
	// P1-C: wire the read-receipt sender to the active room's E2EE channel
	// P1-C: 把已读回执发送器接到当前房间的 E2EE 通道
	setReadReceiptSender((ids) => {
		const rd = roomsData[activeRoomIndex];
		if (rd && rd.chat) rd.chat.sendReadReceipts(ids);
	});
	// P1-C: when the window becomes readable again, scan the visible backlog
	// and report what the user can actually see. Read rule: visible+focused.
	// P1-C: 窗口重新可读时扫描可见积压，上报确实能看到的消息。
	const scanVisibleBacklog = () => {
		if (!isWindowReading()) return;
		const rd = roomsData[activeRoomIndex];
		if (!rd || !Array.isArray(rd.messages)) return;
		const tail = rd.messages.slice(-40);
		for (const entry of tail) {
			if (entry.type === 'other' && entry.id && !entry.readSent) {
				entry.readSent = true;
				queueReadReceipt(entry.id)
			}
		}
	};
	document.addEventListener('visibilitychange', scanVisibleBacklog);
	window.addEventListener('focus', scanVisibleBacklog);
	setupImagePreview();	setupEmojiPicker();
	// 由于我们已经在DOM加载前预先初始化了语言设置，这里不需要重复初始化
	// initSettings();
	// updateStaticTexts(); // 在初始化设置后更新静态文本 / Update static texts after initializing settings
	initTheme(); // 初始化主题 / Initialize theme
	
	const settingsBtn = $id('settings-btn'); // 设置按钮 / Settings button
	if (settingsBtn) {
		settingsBtn.onclick = (e) => {
			e.stopPropagation();  // 阻止事件冒泡 / Stop event from bubbling
			openSettingsPanel(); // 打开设置面板 / Open settings panel
		}
	}

	// 设置返回按钮事件处理 / Settings back button event handler
	const settingsBackBtn = $id('settings-back-btn');
	if (settingsBackBtn) {
		settingsBackBtn.onclick = (e) => {
			e.stopPropagation();
			closeSettingsPanel(); // 关闭设置面板 / Close settings panel
		}
	}
	// 点击其他地方时关闭设置面板 (已移除，因为现在使用侧边栏形式)
	// Close settings panel when clicking outside (removed since we now use sidebar format)
	const input = document.querySelector('.input-message-input'); // 消息输入框 / Message input box
	
	// 设置图片粘贴功能
	// Setup image paste functionality
	const imagePasteHandler = setupImagePaste('.input-message-input');

	// ==================== v1.3.0 #13: Web Share Target hand-off ====================
	// SW 把系统分享的 文本/图片 暂存在 Cache（'./__share-payload'）后 302 回
	// ?share=1；这里取走即焚：读一条、删一条、URL 清理。iOS 不支持（文档已注明）。
	if (new URLSearchParams(window.location.search).get('share') === '1') {
		(async () => {
			try {
				if (!('caches' in window)) return;
				const cache = await caches.open('jmlt-share-v1');
				const hit = await cache.match('./__share-payload');
				await cache.delete('./__share-payload');
				try { history.replaceState(null, '', location.pathname) } catch (_e) { /* keep query */ }
				if (!hit) return;
				const payload = await hit.json();
				let filled = 0;
				const parts = [];
				const text = (payload.text || '').trim();
				const title = (payload.title || '').trim();
				const sharedUrl = (payload.url || '').trim();
				if (text) parts.push(text);
				else if (title && sharedUrl) parts.push(title);
				if (sharedUrl && parts.indexOf(sharedUrl) === -1 && !text.includes(sharedUrl)) parts.push(sharedUrl);
				const inputEl = document.querySelector('.input-message-input');
				if (inputEl && parts.length) {
					inputEl.innerText = parts.join('\n');
					inputEl.dispatchEvent(new Event('input', { bubbles: true }));
					filled++
				}
				if (imagePasteHandler && Array.isArray(payload.files)) {
					for (const f of payload.files) {
						if (imagePasteHandler.addImage(f.dataUrl)) filled++
					}
				}
				if (filled) {
					inputEl && inputEl.focus();
					addSystemMsg(t('system.share_received', 'Shared content added to the composer — nothing was stored.'), true)
				}
			} catch (_e) { /* hand-off is best-effort */ }
		})()
	}

	// ==================== P2: typing signal + local draft ====================
	// 输入事件三合一（各自节流/防抖）：
	// - typing 信号：sendTyping 内部 3s 节流，空内容走 E2EE 信封
	// - 草稿保存：400ms 防抖写 sessionStorage（仅本标签页会话）
	// - （placeholder 检查已由 setupInputPlaceholder 处理）
	let draftTimer = null;
	input.addEventListener('input', () => {
		const rd = roomsData[activeRoomIndex];
		if (rd && rd.chat) {
			if (typeof rd.chat.sendTyping === 'function') {
				rd.chat.sendTyping() // throttled inside / 内部已节流
			}
			if (rd.chat.credentials) {
				const channelHash = rd.chat.credentials.channel;
				clearTimeout(draftTimer);
				draftTimer = setTimeout(() => saveDraft(channelHash, input.innerHTML), 400)
			}
		}
	});
	
	if (input) {
		input.focus(); // 自动聚焦 / Auto focus
		input.addEventListener('keydown', (e) => {
			// 按下 Enter 键并且不按 Shift，表示发送消息
			// Pressing Enter (without Shift) sends the message
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});
	}
	
	// 发送消息的统一函数
	// Unified function to send messages
	// Parse @Name tokens in text against current room members -> clientIds.
	// Mention data travels inside the E2EE content layer only (RULES.md invariant 1).
	function parseMentions(text, rd) {
		const ids = [];
		if (!text || !rd || !rd.userMap) return ids;
		const tokens = new Set();
		const re = /@([^\s@]{1,32})/gu;
		let m;
		while ((m = re.exec(text))) tokens.add(m[1]);
		for (const token of tokens) {
			const lower = token.toLowerCase();
			for (const cid in rd.userMap) {
				const u = rd.userMap[cid];
				const name = u ? (u.userName || u.username || u.name || '') : '';
				if (name && name.toLowerCase() === lower && ids.indexOf(cid) === -1) ids.push(cid);
			}
		}
		return ids;
	}

	// v1.2.0 #11: public-channel send extracted so the offline queue can
	// replay the exact same action after reconnect. Mentions are parsed at
	// execution time (userMap may have changed while offline).
	// v1.2.0 #11：公共频道发送逻辑抽出来，离线队列重连后原样重放。@提及在
	// 执行时解析（离线期间 userMap 可能已变）。
	function executePublicSend(rd, sendText, sendImages, replyCap, sendTtl) {
		if (!rd || !rd.chat) return;
		const replyAllowed = !!(replyCap && replyCap.scope !== 'private');
		if (sendImages.length > 0) {
			const messageContent = { text: sendText || '', images: sendImages };
			const imgMid = rd.chat.sendChannelMessage('image', messageContent);
			addMsg(messageContent, false, 'image', null, { id: typeof imgMid === 'string' ? imgMid : null });
			return
		}
		if (!sendText) return;
		const mentionIds = parseMentions(sendText, rd);
		const extras = {};
		if (mentionIds.length) extras.m = mentionIds;
		if (replyAllowed) {
			extras.rt = replyCap.id;
			extras.q = { u: replyCap.name, x: replyCap.snippet };
		}
		if (sendTtl) extras.ttl = sendTtl;
		const mid = rd.chat.sendChannelMessage('text', sendText, Object.keys(extras).length ? extras : undefined);
		addMsg(sendText, false, 'text', null, {
			id: typeof mid === 'string' ? mid : null,
			mentions: mentionIds,
			quote: replyAllowed ? { u: replyCap.name, x: replyCap.snippet } : null,
			ttl: sendTtl || null
		});
	}

	function sendMessage() {
		const text = input.innerText.trim(); // 获取输入的文本 / Get input text
		const images = imagePasteHandler ? imagePasteHandler.getCurrentImages() : []; // 获取所有图片

		if (!text && images.length === 0) return; // 如果没有文本且没有图片，则不发送
		const rd = roomsData[activeRoomIndex]; // 当前房间数据 / Current room data

		// P1-B: editing flow — send an encrypted edit instead of a new message
		// P1-B：编辑流程——发送加密 edit，而不是新消息
		const editing = getPendingEdit();
		if (editing) {
			const editText = input.innerText.trim();
			if (editText && rd && rd.chat) {
				const editMentions = parseMentions(editText, rd);
				if (rd.chat.sendEdit(editing.id, editText, editMentions)) {
					applyEditLocal(rd, editing.id, editText, editMentions);
				}
				clearPendingEdit();
				input.innerHTML = '';
				if (imagePasteHandler && typeof imagePasteHandler.refreshPlaceholder === 'function') {
					imagePasteHandler.refreshPlaceholder();
				}
				autoGrowInput();
			}
			return;
		}

		if (rd && rd.chat) {
			// P1-B: reply target + burn timer (scope-guarded: a private-source
			// reply may only attach to a private send, and vice versa — so a
			// private quote can never leak into the public channel)
			// P1-B：回复目标 + 焚毁定时（作用域守卫，杜绝私聊引用串台）
			const reply = getPendingReply();
			const ttl = getBurnTtl();
			const replyAllowed = !!(reply && ((reply.scope === 'private') === (rd.privateChatTargetId != null)));
			// v1.2.0 #11: offline + public target → queue instead of dropping.
			// Memory-only queue (see util.sendQueue.js header); private sends
			// and edits keep their existing paths (clientId/mid cannot survive
			// a reconnect — honest scope limit).
			// v1.2.0 #11：离线且发公共频道 → 入队而不是丢弃。仅内存队列（见
			// util.sendQueue.js 头注释）；私聊与编辑保持原路径（clientId/mid
			// 重连即失效——诚实边界）。
			if (!rd.privateChatTargetId && !isRoomConnected(rd)) {
				const replyCap = reply ? { id: reply.id, name: reply.name, snippet: reply.snippet, scope: reply.scope } : null;
				enqueueSend(rd, () => executePublicSend(rd, text, images, replyCap, ttl));
				addSystemMsg(t('system.queued_offline', 'Offline — message queued and will be sent after reconnect.'), true);
				if (rd.chat.credentials) clearDraft(rd.chat.credentials.channel);
				input.innerHTML = '';
				if (imagePasteHandler && typeof imagePasteHandler.refreshPlaceholder === 'function') {
					imagePasteHandler.refreshPlaceholder();
				}
				autoGrowInput();
				if (reply) clearPendingReply();
				return;
			}
			if (images.length > 0) {
				// 发送包含图片的消息 (支持多图和文字合并)
				// Send message with images (supports multiple images and text combined)
				const messageContent = {
					text: text || '', // 包含文字内容，如果有的话
					images: images    // 包含所有图片数据
				};

				if (rd.privateChatTargetId) {
					// 私聊图片消息加密并发送
					// Encrypt and send private image message
					const targetClient = rd.chat.channel[rd.privateChatTargetId];
					if (targetClient && targetClient.shared) {
						const clientMessagePayload = {
							a: 'm',
							t: 'image_private',
							d: messageContent,
							id: rd.chat.genMessageId()
						};
						const encryptedClientMessage = rd.chat.encryptClientMessage(clientMessagePayload, targetClient.shared);
						const serverRelayPayload = {
							a: 'c',
							p: encryptedClientMessage,
							c: rd.privateChatTargetId
						};
						const encryptedMessageForServer = rd.chat.encryptServerMessage(serverRelayPayload, rd.chat.serverShared);						rd.chat.sendMessage(encryptedMessageForServer);
						addMsg(messageContent, false, 'image_private', null, { id: clientMessagePayload.id });
					} else {
						addSystemMsg(`${t('system.private_message_failed', 'Cannot send private message to')} ${rd.privateChatTargetName}. ${t('system.user_not_connected', 'User might not be fully connected.')}`)
					}
				} else {
					// 公共频道图片消息发送（v1.2.0 #11: 逻辑已抽出共用）
					executePublicSend(rd, text, images, reply, ttl);
				}

				imagePasteHandler.clearImages(); // 清除所有图片预览
			} else if (text) {
				// 发送纯文本消息
				// Send text-only message
				if (rd.privateChatTargetId) {
					// 私聊文本消息加密并发送（P1-B: 附带回复/焚毁字段，均在内容层）
					// Encrypt and send private text message (reply/burn fields stay in content layer)
					const targetClient = rd.chat.channel[rd.privateChatTargetId];
					if (targetClient && targetClient.shared) {
						const clientMessagePayload = {
							a: 'm',
							t: 'text_private',
							d: text,
							id: rd.chat.genMessageId()
						};
						if (replyAllowed) {
							clientMessagePayload.rt = reply.id;
							clientMessagePayload.q = { u: reply.name, x: reply.snippet };
						}
						if (ttl) clientMessagePayload.ttl = ttl;
						const encryptedClientMessage = rd.chat.encryptClientMessage(clientMessagePayload, targetClient.shared);
						const serverRelayPayload = {
							a: 'c',
							p: encryptedClientMessage,
							c: rd.privateChatTargetId
						};
						const encryptedMessageForServer = rd.chat.encryptServerMessage(serverRelayPayload, rd.chat.serverShared);
						rd.chat.sendMessage(encryptedMessageForServer);					addMsg(text, false, 'text_private', null, {
							id: clientMessagePayload.id,
							quote: replyAllowed ? { u: reply.name, x: reply.snippet } : null,
							ttl: ttl || null
						});
					} else {
						addSystemMsg(`${t('system.private_message_failed', 'Cannot send private message to')} ${rd.privateChatTargetName}. ${t('system.user_not_connected', 'User might not be fully connected.')}`)
					}
				} else {
					// 公共频道消息发送（携带 @提及，走 E2EE 内容层）
					// v1.2.0 #11: 逻辑已抽出共用
					executePublicSend(rd, text, images, reply, ttl);
				}
				if (reply) clearPendingReply();
			}

			// 清空输入框并触发 input 事件
			// Clear input and trigger input event
			const rdSent = roomsData[activeRoomIndex];
			if (rdSent && rdSent.chat && rdSent.chat.credentials) {
				clearDraft(rdSent.chat.credentials.channel) // P2: 已发送，草稿即焚
			}
			input.innerHTML = ''; // 清空输入框内容 / Clear input field content
			if (imagePasteHandler && typeof imagePasteHandler.refreshPlaceholder === 'function') {
				imagePasteHandler.refreshPlaceholder(); // 更新 placeholder 状态
			}
			autoGrowInput(); // 调整输入框高度
		}
	}
	
	// 为发送按钮添加点击事件
	// Add click event for send button
	const sendButton = document.querySelector('.send-message-btn');
	if (sendButton) {
		sendButton.addEventListener('click', sendMessage);
	}
	
	// 设置发送文件功能
	// Setup file sending functionality
	setupFileSend({
		inputSelector: '.input-message-input', // 消息输入框选择器 / Message input selector
		attachBtnSelector: '.chat-attach-btn', // 附件按钮选择器 / Attach button selector
		fileInputSelector: '.new-message-wrapper input[type="file"]', // 文件输入框选择器 / File input selector
		onSend: (message) => {
			const rd = roomsData[activeRoomIndex];
			if (rd && rd.chat) {
				const userName = rd.myUserName || '';
				const msgWithUser = { ...message, userName };
				if (rd.privateChatTargetId) {
					// 私聊文件加密并发送
					// Encrypt and send private file message
					const targetClient = rd.chat.channel[rd.privateChatTargetId];
					if (targetClient && targetClient.shared) {
						const clientMessagePayload = {
							a: 'm',
							t: msgWithUser.type + '_private',
							d: msgWithUser,
							id: rd.chat.genMessageId()
						};
						const encryptedClientMessage = rd.chat.encryptClientMessage(clientMessagePayload, targetClient.shared);
						const serverRelayPayload = {
							a: 'c',
							p: encryptedClientMessage,
							c: rd.privateChatTargetId
						};
						const encryptedMessageForServer = rd.chat.encryptServerMessage(serverRelayPayload, rd.chat.serverShared);
						rd.chat.sendMessage(encryptedMessageForServer);
						
						// 添加到自己的聊天记录
						if (msgWithUser.type === 'file_start') {
							addMsg(msgWithUser, false, 'file_private', null, { id: clientMessagePayload.id });
						}					} else {
						addSystemMsg(`${t('system.private_file_failed', 'Cannot send private file to')} ${rd.privateChatTargetName}. ${t('system.user_not_connected', 'User might not be fully connected.')}`)
					}
				} else {
					// 公共频道文件发送
					// Send file to public channel
					const fileMid = rd.chat.sendChannelMessage(msgWithUser.type, msgWithUser);

					// 添加到自己的聊天记录
					if (msgWithUser.type === 'file_start') {
						addMsg(msgWithUser, false, 'file', null, { id: typeof fileMid === 'string' ? fileMid : null });
					}
				}
			}		}
	});


	// 判断是否为移动端
	// Check if the device is mobile
	const isMobile = () => window.innerWidth <= 768;

	// 渲染主界面元素
	// Render main UI elements
	renderMainHeader();
	renderUserList();
	setupTabs();

	const roomList = $id('room-list');
	const sidebar = $id('sidebar');
	const rightbar = $id('rightbar');
	const sidebarMask = $id('mobile-sidebar-mask');
	const rightbarMask = $id('mobile-rightbar-mask');

	// 在移动端点击房间列表后关闭侧边栏
	// On mobile, clicking room list closes sidebar
	if (roomList) {
		roomList.addEventListener('click', () => {
			if (isMobile()) {
				sidebar?.classList.remove('mobile-open');
				sidebarMask?.classList.remove('active');
			}
		});
	}

	// 在移动端点击成员标签后关闭右侧面板
	// On mobile, clicking member tabs closes right panel
	const memberTabs = $id('member-tabs');
	if (memberTabs) {
		memberTabs.addEventListener('click', () => {
			if (isMobile()) {
				removeClass(rightbar, 'mobile-open');
				removeClass(rightbarMask, 'active');
			}
		});
	}
});

// Listen for language change events
// 监听语言切换事件
window.addEventListener('languageChange', (event) => {
	updateStaticTexts();
});

// 全局拖拽文件自动打开附件功能
// Global drag file to auto trigger attach button
let dragCounter = 0;
let hasTriggeredAttach = false;

// 监听文件上传模态框关闭事件，重置拖拽标志位
window.addEventListener('fileUploadModalClosed', () => {
	hasTriggeredAttach = false;
});

document.addEventListener('dragenter', (e) => {
	dragCounter++;
	if (!hasTriggeredAttach && e.dataTransfer.items.length > 0) {
		// 检查是否有文件
		for (let item of e.dataTransfer.items) {
			if (item.kind === 'file') {
				// 自动点击附件按钮
				const attachBtn = document.querySelector('.chat-attach-btn');
				if (attachBtn) {
					attachBtn.click();
					hasTriggeredAttach = true;
				}
				break;
			}
		}
	}
});

document.addEventListener('dragleave', (e) => {
	dragCounter--;
	if (dragCounter === 0) {
		hasTriggeredAttach = false;
	}
});

document.addEventListener('dragover', (e) => {
	e.preventDefault();
});

document.addEventListener('drop', (e) => {
	e.preventDefault();
	dragCounter = 0;
	hasTriggeredAttach = false;
	// P2: 落下的文件直接进上传模态框，不再只是"打开模态框然后丢失文件"。
	// P2: route dropped files straight into the upload modal instead of just
	// opening it and losing the payload.
	const dropped = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
	if (dropped.length === 0) return;
	if (!handleExternalDrop(dropped)) {
		const attachBtn = document.querySelector('.chat-attach-btn');
		if (attachBtn) {
			attachBtn.click(); // opens the modal synchronously / 同步打开模态框
			setTimeout(() => handleExternalDrop(dropped), 0)
		}
	}
});

// P1-A: 初始化 PWA（Service Worker 只缓存静态应用壳，绝不缓存消息内容）
initPWA();

// v1.1.0 #2: panic hotkey — Ctrl+Shift+Backspace (documented in the settings
// panel). Double-confirm lives inside panicWipeWithConfirm().
// v1.1.0 #2：恐慌快捷键 Ctrl+Shift+Backspace（设置面板有文案说明）。
// 双重确认在 panicWipeWithConfirm() 内部。
window.addEventListener('keydown', (e) => {
	if (e.ctrlKey && e.shiftKey && e.key === 'Backspace') {
		e.preventDefault();
		panicWipeWithConfirm();
	}
});

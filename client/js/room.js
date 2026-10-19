// Room management logic for NodeCrypt web client
// NodeCrypt 网页客户端的房间管理逻辑

import {
	createAvatarSVG
} from './util.avatar.js';
import {
	renderChatArea,
	addSystemMsg,
	updateChatInputStyle,
	toggleReactionLocal,
	renderReactions,
	updateTypingIndicator,
	saveDraft,
	loadDraft,
	clearDraft,
	recallMessageLocal,
	burnMessageLocal,
	applyEditLocal,
	armBurnTimer,
	queueReadReceipt,
	isWindowReading,
	markMessageReadDom
} from './chat.js';
import { reportPushSubscription } from './util.push.js';
import { selectReplayable, dedupeReplayBatch } from './util.validate.js';
import {
	renderMainHeader,
	renderUserList
} from './ui.js';
import {
	escapeHTML
} from './util.string.js';
import {
	$id,
	createElement
} from './util.dom.js';
import { t } from './util.i18n.js';
import {
	setupRoomHistory,
	loadLocalHistory,
	appendLocalHistory
} from './util.localHistory.js';
// P1-C note: roomsData is exported at the file tail (export { roomsData, ... });
// util.push.js reads it via the injected accessor, not via import.
// P1-C 说明：roomsData 在文件尾部导出；util.push.js 通过注入的访问器读取。
let roomsData = [];
let activeRoomIndex = -1;

// Get a new room data object
// 获取一个新的房间数据对象
export function getNewRoomData() {
	return {
		roomName: '',
		userList: [],
		userMap: {},
		myId: null,
		myUserName: '',
		chat: null,
		messages: [],
		prevUserList: [],
		knownUserIds: new Set(),
		unreadCount: 0,
		privateChatTargetId: null,
		privateChatTargetName: null,
		typingUsers: {} // clientId -> timestamp of last typing signal
	}
}

// Switch to another room by index
// 切换到指定索引的房间
export function switchRoom(index) {
	if (index < 0 || index >= roomsData.length) return;
	activeRoomIndex = index;
	const rd = roomsData[index];
	if (typeof rd.unreadCount === 'number') rd.unreadCount = 0;
	const sidebarUsername = document.getElementById('sidebar-username');
	if (sidebarUsername) sidebarUsername.textContent = rd.myUserName;
	setSidebarAvatar(rd.myUserName);
	renderRooms(index);
	renderMainHeader();
	renderUserList(false);
	renderChatArea();
	updateChatInputStyle();
	// P2: restore this room's local draft into the input box, then refresh
	// the typing indicator for the room we just switched to.
	// P2：把该房间的本地草稿填回输入框，并刷新输入中指示。
	const inputEl = document.querySelector('.input-message-input');
	if (inputEl) {
		const channelHash = rd.chat && rd.chat.credentials ? rd.chat.credentials.channel : '';
		inputEl.innerHTML = loadDraft(channelHash);
		inputEl.dispatchEvent(new Event('input', {
			bubbles: true
		}))
	}
	renderTypingForRoom(index)
}

// ==================== P2: typing indicator handling ====================
// Record an incoming typing signal and refresh the indicator. Entries
// auto-expire after TYPING_TIMEOUT ms without a refresh — the signal
// carries no content, so there is nothing to persist or render beyond
// the member's name.
const TYPING_TIMEOUT = 5000;

// Handle an incoming typing signal from a room member.
export function handleClientTyping(idx, msg) {
	const rd = roomsData[idx];
	if (!rd || !msg || !msg.clientId) return;
	if (msg.clientId === rd.myId) return; // ignore self
	rd.typingUsers = rd.typingUsers || {};
	rd.typingUsers[msg.clientId] = {
		username: msg.username || '',
		timestamp: Date.now()
	};
	if (idx === activeRoomIndex) renderTypingForRoom(idx);
	// schedule expiry check
	setTimeout(() => expireTyping(idx), TYPING_TIMEOUT + 250)
}

// Drop stale typing entries and refresh the indicator if needed.
function expireTyping(idx) {
	const rd = roomsData[idx];
	if (!rd || !rd.typingUsers) return;
	const now = Date.now();
	let changed = false;
	for (const clientId in rd.typingUsers) {
		if (now - rd.typingUsers[clientId].timestamp > TYPING_TIMEOUT) {
			delete rd.typingUsers[clientId];
			changed = true
		}
	}
	if (changed && idx === activeRoomIndex) renderTypingForRoom(idx)
}

// Render the typing indicator for room `idx` from its typing map.
function renderTypingForRoom(idx) {
	const rd = roomsData[idx];
	if (!rd) return;
	if (idx !== activeRoomIndex) {
		updateTypingIndicator([]);
		return
	}
	const names = Object.values(rd.typingUsers || {})
		.filter(entry => Date.now() - entry.timestamp <= TYPING_TIMEOUT)
		.map(entry => entry.username);
	updateTypingIndicator(names)
}

// Called when a member leaves so their typing entry does not linger.
export function clearTypingUser(idx, clientId) {
	const rd = roomsData[idx];
	if (!rd || !rd.typingUsers || !rd.typingUsers[clientId]) return;
	delete rd.typingUsers[clientId];
	if (idx === activeRoomIndex) renderTypingForRoom(idx)
}

// Set the sidebar avatar
// 设置侧边栏头像
export function setSidebarAvatar(userName) {
	if (!userName) return;
	const svg = createAvatarSVG(userName);
	const el = $id('sidebar-user-avatar');
	if (el) {
		const cleanSvg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		el.innerHTML = cleanSvg
	}
}

// Render the room list
// 渲染房间列表
export function renderRooms(activeId = 0) {
	const roomList = $id('room-list');
	roomList.innerHTML = '';
	roomsData.forEach((rd, i) => {
		const div = createElement('div', {
			class: 'room' + (i === activeId ? ' active' : ''),
			onclick: () => switchRoom(i)
		});
		const safeRoomName = escapeHTML(rd.roomName);
		let unreadHtml = '';
		if (rd.unreadCount && i !== activeId) {
			unreadHtml = `<span class="room-unread-badge">${rd.unreadCount>99?'99+':rd.unreadCount}</span>`
		}
		div.innerHTML = `<div class="info"><div class="title">#${safeRoomName}</div></div>${unreadHtml}`;
		roomList.appendChild(div)
	})
}

// Join a room
// 加入一个房间
export function joinRoom(userName, roomName, password, modal = null, onResult) {
	const newRd = getNewRoomData();
	newRd.roomName = roomName;
	newRd.myUserName = userName;
	newRd.password = password;
	roomsData.push(newRd);
	const idx = roomsData.length - 1;
	switchRoom(idx);
	// P3: opt-in encrypted local history — derive the memory-only key, then
	// decrypt and prepend any stored messages (best-effort, never blocks chat).
	setupRoomHistory(newRd, roomName, password).then((channelHash) => {
		if (!channelHash) return;
		return loadLocalHistory(roomName, password, channelHash).then((entries) => {
			if (!entries.length) return;
			newRd.messages = entries.concat(newRd.messages);
			if (activeRoomIndex === idx) renderChatArea()
		})
	}).catch(() => { /* history is best-effort */ });
	const sidebarUsername = $id('sidebar-username');
	if (sidebarUsername) sidebarUsername.textContent = userName;
	setSidebarAvatar(userName);
	let closed = false;
	const callbacks = {
		onServerClosed: () => {
			setStatus('Node connection closed');
			// P2: mark this room as needing a peer-replay sync once the
			// connection is re-established and the client list refreshes.
			// P2: 标记本房间需要在重连成功（client list 刷新）后发起同伴重播。
			const rdClosed = roomsData[idx];
			if (rdClosed) rdClosed.needsSync = true;
			// P1-C: honest reconnect notice. Server persists nothing (RULES
			// invariant), so messages sent during the gap cannot be backfilled
			// from the server — tell the user instead of silently losing them.
			// P1-C: 诚实的重连提示。服务器零持久化（RULES 不变量），断线窗口内
			// 的消息无从补拉，明确告知而不是无声丢失。
			try {
				addSystemMsg(t('system.reconnecting', 'Connection lost — reconnecting. Messages sent while offline may be missing.'));
			} catch (_e) { /* room list may not be ready yet */ }
			if (onResult && !closed) {
				closed = true;
				onResult(false)
			}
		},		onServerSecured: () => {
			if (modal) modal.remove();
			else {
				const loginContainer = $id('login-container');
				if (loginContainer) loginContainer.style.display = 'none';
				const chatContainer = $id('chat-container');
				if (chatContainer) chatContainer.style.display = '';
				

			}
			if (onResult && !closed) {
				closed = true;
				onResult(true)
			}
			addSystemMsg(t('system.secured', 'connection secured'))
		},
		onClientSecured: (user) => handleClientSecured(idx, user),
		onClientList: (list, selfId) => handleClientList(idx, list, selfId),
		onClientLeft: (clientId) => handleClientLeft(idx, clientId),
		onClientMessage: (msg) => handleClientMessage(idx, msg),
		onClientReaction: (r) => handleClientReaction(idx, r),
		onClientTyping: (msg) => handleClientTyping(idx, msg),
		onClientEdit: (r) => handleClientEdit(idx, r),
		onClientDelete: (r) => handleClientDelete(idx, r),
		onClientReadReceipt: (r) => handleClientReadReceipt(idx, r),
		onClientSync: (r) => handleClientSync(idx, r),
		onClientReplay: (r) => handleClientReplay(idx, r)
	};
	const chatInst = new window.NodeCrypt(window.config, callbacks);
	roomsData[idx].chat = chatInst;
	// setCredentials is async (PBKDF2 key stretching) — connect only after it resolves
	chatInst.setCredentials(userName, roomName, password).then((ok) => {
		if (ok) {
			chatInst.connect()
		} else {
			addSystemMsg(t('system.credential_error', 'Failed to initialize credentials'))
		}
	});
}

// Handle the client list update
// 处理客户端列表更新
export function handleClientList(idx, list, selfId) {
	const rd = roomsData[idx];
	if (!rd) return;
	const oldUserIds = new Set((rd.userList || []).map(u => u.clientId));
	const newUserIds = new Set(list.map(u => u.clientId));
	for (const oldId of oldUserIds) {
		if (!newUserIds.has(oldId)) {
			handleClientLeft(idx, oldId)
		}
	}
	rd.userList = list;
	rd.userMap = {};
	list.forEach(u => {
		rd.userMap[u.clientId] = u
	});
	rd.myId = selfId;
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
	rd.initCount = (rd.initCount || 0) + 1;
	if (rd.initCount === 2) {
		rd.isInitialized = true;
		rd.knownUserIds = new Set(list.map(u => u.clientId))
	}
	// P1-C: report push subscription on first init and again at most every
	// 5 minutes — server-side subscription storage can be evicted with the
	// DO, and re-reporting is an idempotent no-op for the server.
	// P1-C: 首次建立后上报，之后每 5 分钟最多重报一次（DO 存储可能被驱逐；
	// 重报对服务器是幂等操作）。
	const nowTs = Date.now();
	if (!rd._lastPushReport || (nowTs - rd._lastPushReport) > 5 * 60 * 1000) {
		rd._lastPushReport = nowTs;
		reportPushSubscription(rd.chat);
	}
	// P2: peer replay sync — if the connection dropped and is back, ask
	// online peers to replay what was missed. Only when at least one other
	// peer holds the room key; the flag survives until peers exist.
	// P2: 同伴重播——断线重连后向在线同伴请求补发缺失消息。需至少一名持房间
	// 密钥的同伴；无同伴时保留标记等下次列表刷新。
	if (rd.needsSync && rd.isInitialized) {
		if (list.length > 1 && rd.chat && typeof rd.chat.sendSyncRequest === 'function') {
			rd.needsSync = false;
			let since = 0;
			const knownIds = [];
			for (const m of rd.messages) {
				if (!m || !m.id) continue;
				if (typeof m.timestamp === 'number' && m.timestamp > since) since = m.timestamp;
				if (knownIds.length < 20) knownIds.push(m.id);
			}
			try {
				rd.chat.sendSyncRequest(since, knownIds);
			} catch (_e) { /* sync is best-effort */ }
		}
	}
}

// Handle client secured event
// 处理客户端安全连接事件
export function handleClientSecured(idx, user) {
	const rd = roomsData[idx];
	if (!rd) return;
	rd.userMap[user.clientId] = user;
	const existingUserIndex = rd.userList.findIndex(u => u.clientId === user.clientId);
	if (existingUserIndex === -1) {
		rd.userList.push(user)
	} else {
		rd.userList[existingUserIndex] = user
	}
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
	if (!rd.isInitialized) {
		return
	}
	const isNew = !rd.knownUserIds.has(user.clientId);
	if (isNew) {
		rd.knownUserIds.add(user.clientId);		const name = user.userName || user.username || user.name || t('ui.anonymous', 'Anonymous');
		const msg = `${name} ${t('system.joined', 'joined the conversation')}`;
		rd.messages.push({
			type: 'system',
			text: msg
		});
		if (activeRoomIndex === idx) addSystemMsg(msg, true);
		if (window.notifyMessage) {
			window.notifyMessage(rd.roomName, 'system', msg, '', rd.chat && rd.chat.credentials ? rd.chat.credentials.channel : '')
		}
	}
}

// Handle client left event
// 处理客户端离开事件
export function handleClientLeft(idx, clientId) {
	const rd = roomsData[idx];
	if (!rd) return;
	if (rd.privateChatTargetId === clientId) {
		rd.privateChatTargetId = null;
		rd.privateChatTargetName = null;
		if (activeRoomIndex === idx) {
			updateChatInputStyle()
		}
	}
	const user = rd.userMap[clientId];
	const name = user ? (user.userName || user.username || user.name || 'Anonymous') : 'Anonymous';
	const msg = `${name} ${t('system.left', 'left the conversation')}`;
	rd.messages.push({
		type: 'system',
		text: msg
	});
	if (activeRoomIndex === idx) addSystemMsg(msg, true);
	rd.userList = rd.userList.filter(u => u.clientId !== clientId);
	delete rd.userMap[clientId];
	clearTypingUser(idx, clientId); // P2: don't let a departed member's typing state linger
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
}

// Handle incoming emoji reaction (content-layer action, E2EE; server never sees it)
// 处理收到的表情回应（内容层 action，端到端加密；服务器不可见）
export function handleClientReaction(idx, r) {
	const rd = roomsData[idx];
	if (!rd || !r || !r.targetId || !r.emoji) return;
	// SECURITY: whitelist-validate remote fields before touching state/DOM
	if (!/^[A-Za-z0-9]{8,32}$/.test(r.targetId)) return;
	if (typeof r.emoji !== 'string' || !r.emoji || r.emoji.length > 16) return;
	toggleReactionLocal(rd, r.targetId, r.emoji, r.clientId);
	if (activeRoomIndex === idx) {
		renderReactions(r.targetId)
	}
}

// P1-B: handle a verified-then-rechecked remote edit. Authorship is enforced
// here (author clientId must match) in addition to the 15-minute window
// checked in applyEditLocal — room members cannot edit each other's messages.
// P1-B：处理远端编辑。双重校验：作者匹配 + 15 分钟时限，防伪造。
export function handleClientEdit(idx, r) {
	const rd = roomsData[idx];
	if (!rd || !r || !r.targetId) return;
	if (!/^[A-Za-z0-9]{8,32}$/.test(r.targetId)) return;
	if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > 10000) return;
	const entry = rd.messages.find(m => m.id === r.targetId);
	if (!entry || entry.burned || entry.deleted) return;
	if (!entry.author || !r.clientId || entry.author !== r.clientId) return;
	applyEditLocal(rd, r.targetId, r.text, Array.isArray(r.mentions) ? r.mentions : [])
}

// P1-B: handle a remote recall. Same authorship rule — only the original
// author's 'del' is honored.
// P1-B：处理远端撤回。同一作者规则——只认原作者的 'del'。
export function handleClientDelete(idx, r) {
	const rd = roomsData[idx];
	if (!rd || !r || !r.targetId) return;
	if (!/^[A-Za-z0-9]{8,32}$/.test(r.targetId)) return;
	const entry = rd.messages.find(m => m.id === r.targetId);
	if (!entry || entry.burned || entry.deleted) return;
	if (!entry.author || !r.clientId || entry.author !== r.clientId) return;
	recallMessageLocal(rd, r.targetId)
}

// P1-C: handle read receipts from a peer. Only OUR OWN messages can be
// marked read by someone else's receipt — the ids listed are ones the peer
// actually saw (their window was visible + focused).
// P1-C：处理对端已读回执。别人的回执只能标记「我发的」消息——id 是对方
// 确实看过（窗口可见且聚焦）的。
export function handleClientReadReceipt(idx, r) {
	const rd = roomsData[idx];
	if (!rd || !r || !Array.isArray(r.ids)) return;
	let changed = false;
	for (const mid of r.ids) {
		if (!mid || !/^[A-Za-z0-9]{8,32}$/.test(mid)) continue;
		const entry = rd.messages.find(m => m.id === mid && m.type === 'me');
		if (entry && !entry.read) {
			entry.read = true;
			changed = true;
			if (activeRoomIndex === idx) markMessageReadDom(mid)
		}
	}
	void changed; // DOM updated per-id above; history re-render picks up entry.read
}

// P2: answer a reconnecting peer's sync request by replaying matching
// messages from this client's in-memory buffer (text/image only, capped).
// Content flows peer-to-peer inside the room key; the server stays blind.
// P2: 应答重连方的同步请求，从本端内存缓冲重播匹配消息（仅文本/图片，有上限）。
// 内容仅在持房间密钥的同伴间流动，服务器全盲。
export function handleClientSync(idx, r) {
	const rd = roomsData[idx];
	if (!rd || !r || !r.clientId || r.clientId === rd.myId) return;
	if (!rd.chat || typeof rd.chat.sendSyncReplay !== 'function') return;
	const since = (typeof r.since === 'number' && r.since >= 0) ? r.since : 0;
	const known = new Set(Array.isArray(r.ids) ? r.ids : []);
	// R5: selection/sanitization now lives in the pure, unit-tested helper.
	const out = selectReplayable(rd.messages, since, known, rd.myUserName || '');
	if (out.length > 0) {
		try {
			rd.chat.sendSyncReplay(r.clientId, out);
		} catch (_e) { /* replay is best-effort */ }
	}
}

// P2: apply a replay batch received from a peer after reconnecting.
// Dedupe by message id, append (entries are all newer than our watermark,
// so chronological append is correct up to clock skew), persist to the
// opt-in encrypted local history, re-render once.
// P2: 应用重连后收到的重播批次。按消息 id 去重后顺序追加（重播条目全部晚于
// 本端水位，时序正确），写入本地加密历史，最后统一重渲染一次。
export function handleClientReplay(idx, r) {
	const rd = roomsData[idx];
	if (!rd || !r || !Array.isArray(r.msgs) || r.msgs.length === 0) return;
	const existing = new Set(rd.messages.filter(m => m.id).map(m => m.id));
	// R5: dedupe + sanitization now lives in the pure, unit-tested helper.
	const batch = dedupeReplayBatch(r.msgs, existing);
	if (!batch.length) return;
	for (const e of batch) {
		const realUserName = e.u || (e.self ? (rd.myUserName || '') : t('ui.anonymous', 'Anonymous'));
		const entry = {
			type: 'other',
			text: e.d,
			userName: realUserName,
			avatar: realUserName,
			msgType: e.t === 'image' ? 'image' : 'text',
			timestamp: e.ts || Date.now(),
			id: e.id,
			reactions: null,
			mentions: e.m.length ? e.m : null,
			mentionsMe: e.m.length && rd.myId && e.m.indexOf(rd.myId) !== -1,
			fromSync: true
		};
		if (e.q) entry.quote = e.q;
		if (e.ttl) entry.ttl = e.ttl;
		rd.messages.push(entry);
		// opt-in encrypted local history (no-op unless enabled + key derived)
		appendLocalHistory(rd, {
			type: 'other',
			text: entry.text,
			userName: entry.userName,
			msgType: entry.msgType,
			timestamp: entry.timestamp,
			id: entry.id,
			ttl: entry.ttl
		});
	}
	const msg = `${batch.length} ${t('system.sync_done', 'missed message(s) restored from peers')}`;
	rd.messages.push({ type: 'system', text: msg });
	if (activeRoomIndex === idx) {
		renderChatArea(); // full re-render covers the batch + system note
	}
}

// Handle client message event
// 处理客户端消息事件
export function handleClientMessage(idx, msg) {
	const newRd = roomsData[idx];
	if (!newRd) return;

	// Prevent processing own messages unless it's a private message sent to oneself
	if (msg.clientId === newRd.myId && msg.userName === newRd.myUserName && !msg.type.includes('_private')) {
		return;
	}

	let msgType = msg.type || 'text';

	// Handle file messages
	if (msgType.startsWith('file_')) {
		// Part 1: Update message history and send notifications (for 'file_start' type)
		if (msgType === 'file_start' || msgType === 'file_start_private') {
			let realUserName = msg.userName;
			if (!realUserName && msg.clientId && newRd.userMap[msg.clientId]) {
				realUserName = newRd.userMap[msg.clientId].userName || newRd.userMap[msg.clientId].username || newRd.userMap[msg.clientId].name;
			}
			const historyMsgType = msgType === 'file_start_private' ? 'file_private' : 'file';
			
			const fileId = msg.data && msg.data.fileId;
			if (fileId) { // Only proceed if we have a fileId
				const messageAlreadyInHistory = newRd.messages.some(
					m => m.msgType === historyMsgType && m.text && m.text.fileId === fileId && m.userName === realUserName
				);

				if (!messageAlreadyInHistory) {
					newRd.messages.push({
						type: 'other',
						text: msg.data, // This is the file metadata object
						userName: realUserName,
						avatar: realUserName,
						msgType: historyMsgType,
						timestamp: (msg.data && msg.data.timestamp) || Date.now() 
					});
				}
			}

			const notificationMsgType = msgType.includes('_private') ? 'private file' : 'file';
			if (window.notifyMessage && msg.data && msg.data.fileName) {
				window.notifyMessage(newRd.roomName, notificationMsgType, `${msg.data.fileName}`, realUserName, newRd.chat && newRd.chat.credentials ? newRd.chat.credentials.channel : '');
			}
		}

		// Part 2: Handle UI interaction (rendering in active room, or unread count in inactive room)
		if (activeRoomIndex === idx) {
			// If it's the active room, delegate to util.file.js to handle UI and file transfer state.
			// This applies to all file-related messages (file_start, file_volume, file_end, etc.)
			if (window.handleFileMessage) {
				window.handleFileMessage(msg.data, msgType.includes('_private'));
			}
		} else {
			// If it's not the active room, only increment unread count for 'file_start' messages.
			if (msgType === 'file_start' || msgType === 'file_start_private') {
				newRd.unreadCount = (newRd.unreadCount || 0) + 1;
				renderRooms(activeRoomIndex);
			}
		}
		return; // File messages are fully handled.
	}

	// Handle image messages (both new and legacy formats)
	if (msgType === 'image' || msgType === 'image_private') {
		// Already has correct type
	} else if (!msgType.includes('_private')) {
		// Handle legacy image detection
		if (msg.data && typeof msg.data === 'string' && msg.data.startsWith('data:image/')) {
			msgType = 'image';
		} else if (msg.data && typeof msg.data === 'object' && msg.data.image) {
			msgType = 'image';
		}
	}
	let realUserName = msg.userName;
	if (!realUserName && msg.clientId && newRd.userMap[msg.clientId]) {
		realUserName = newRd.userMap[msg.clientId].userName || newRd.userMap[msg.clientId].username || newRd.userMap[msg.clientId].name;
	}

	// Add message to messages array for chat history (keep message id so
	// reactions can target it; mentions carried in content layer)
	// P2: dedupe — a live message can race with a peer replay of the same id
	// P2: 去重——实时消息可能与同伴重播的同一 id 竞争
	if (msg.id && roomsData[idx].messages.some(m => m.id === msg.id)) return;
	const mentionsMe = Array.isArray(msg.mentions) && newRd.myId && msg.mentions.indexOf(newRd.myId) !== -1;
	const tsOther = Date.now();
	roomsData[idx].messages.push({
		type: 'other',
		text: msg.data,
		userName: realUserName,
		avatar: realUserName,
		msgType: msgType,
		timestamp: tsOther,
		id: msg.id || null,
		reactions: null,
		mentions: Array.isArray(msg.mentions) && msg.mentions.length ? msg.mentions : null,
		mentionsMe: mentionsMe,
		author: msg.clientId || null,
		quote: msg.quote || null,
		ttl: msg.ttl || null,
		edited: false,
		deleted: false,
		burned: false
	});
	// P1-B: arm the local burn timer for incoming timed messages
	if (msg.id && msg.ttl) armBurnTimer(newRd, msg.id, msg.ttl, tsOther);
	// P3: opt-in encrypted local history (no-op unless enabled + key derived)
	appendLocalHistory(newRd, {
		type: 'other',
		text: msg.data,
		userName: realUserName,
		msgType: msgType,
		timestamp: tsOther,
		id: msg.id || null,
		ttl: msg.ttl || null
	});

	// P1-C: if the user is actually looking at the message right now, queue a
	// read receipt (debounced batch). Mark entry so background backlog
	// scanning in main.js skips it.
	// P1-C: 用户此刻真在看着这条消息就排队已读回执（防抖合并）。
	if (msg.id && isWindowReading()) {
		roomsData[idx].messages[roomsData[idx].messages.length - 1].readSent = true;
		queueReadReceipt(msg.id)
	}

	// Only add message to chat display if it's for the active room
	if (activeRoomIndex === idx) {
		if (window.addOtherMsg) {
			window.addOtherMsg(msg.data, realUserName, realUserName, false, msgType, null, {
				id: msg.id || null,
				mentions: Array.isArray(msg.mentions) ? msg.mentions : [],
				mentionsMe: mentionsMe,
				quote: msg.quote || null,
				ttl: msg.ttl || null
			});
		}
	} else {
		roomsData[idx].unreadCount = (roomsData[idx].unreadCount || 0) + 1;
		renderRooms(activeRoomIndex);
	}

	const notificationMsgType = msgType.includes('_private') ? `private ${msgType.split('_')[0]}` : msgType;
	if (window.notifyMessage) {
		// A direct @mention gets its own, more intrusive notification
		if (mentionsMe) {
			window.notifyMessage(newRd.roomName, 'mention', msg.data, realUserName, newRd.chat && newRd.chat.credentials ? newRd.chat.credentials.channel : '');
		} else {
			window.notifyMessage(newRd.roomName, notificationMsgType, msg.data, realUserName, newRd.chat && newRd.chat.credentials ? newRd.chat.credentials.channel : '');
		}
	}
}

// Toggle private chat with a user
// 切换与某用户的私聊
export function togglePrivateChat(targetId, targetName) {
	const rd = roomsData[activeRoomIndex];
	if (!rd) return;
	if (rd.privateChatTargetId === targetId) {
		rd.privateChatTargetId = null;
		rd.privateChatTargetName = null
	} else {
		rd.privateChatTargetId = targetId;
		rd.privateChatTargetName = targetName
	}
	renderUserList();
	updateChatInputStyle()
}


// Exit the current room
// 退出当前房间
export function exitRoom() {
	if (activeRoomIndex >= 0 && roomsData[activeRoomIndex]) {
		const chatInst = roomsData[activeRoomIndex].chat;
		if (chatInst && typeof chatInst.destruct === 'function') {
			chatInst.destruct()
		} else if (chatInst && typeof chatInst.disconnect === 'function') {
			chatInst.disconnect()
		}
		roomsData[activeRoomIndex].chat = null;
		roomsData.splice(activeRoomIndex, 1);
		if (roomsData.length > 0) {
			switchRoom(0);
			return true
		} else {
			return false
		}
	}
	return false
}

export { roomsData, activeRoomIndex };

// Listen for sidebar username update event
// 监听侧边栏用户名更新事件
window.addEventListener('updateSidebarUsername', () => {
	if (activeRoomIndex >= 0 && roomsData[activeRoomIndex]) {
		const rd = roomsData[activeRoomIndex];
		const sidebarUsername = document.getElementById('sidebar-username');
		if (sidebarUsername && rd.myUserName) {
			sidebarUsername.textContent = rd.myUserName;
		}
		// Also update the avatar to ensure consistency
		if (rd.myUserName) {
			setSidebarAvatar(rd.myUserName);
		}
	}
});
// ==================== P3: local history events ====================
// React to settings-side changes so already-joined rooms stay in sync.
// 设置面板的开关/清除事件 → 已加入房间同步内存状态。

window.addEventListener('localHistoryCleared', () => {
	roomsData.forEach(rd => {
		if (rd) rd.historyBuffer = []
	})
});

window.addEventListener('localHistorySettingChanged', (e) => {
	const enabled = e && e.detail && e.detail.enabled;
	roomsData.forEach((rd, idx) => {
		if (!rd || !rd.password || !rd.roomName) return;
		if (enabled && !rd.historyKey) {
			// turning ON: derive the memory-only key, then load what's stored
			setupRoomHistory(rd, rd.roomName, rd.password).then((channelHash) => {
				if (!channelHash) return;
				return loadLocalHistory(rd.roomName, rd.password, channelHash).then((entries) => {
					if (entries.length && !rd.historyLoaded) {
						rd.historyLoaded = true;
						rd.messages = entries.concat(rd.messages);
						if (activeRoomIndex === idx) renderChatArea()
					}
				})
			}).catch(() => { /* best-effort */ })
		}
		if (!enabled) {
			// turning OFF: drop the key so appends become no-ops; stored
			// ciphertext is kept until the user explicitly clicks Clear.
			rd.historyKey = null
		}
	})
});

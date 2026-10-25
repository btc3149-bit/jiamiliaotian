// Import necessary modules
// 导入必要的模块
import {
	createAvatarSVG
} from './util.avatar.js';
import {
	roomsData,
	activeRoomIndex
} from './room.js';
import {
	escapeHTML,
	textToHTML
} from './util.string.js';
import {
	$,
	$id,
	createElement,
	on,
	off,
	addClass,
	removeClass
} from './util.dom.js';
import {
	formatFileSize
} from './util.file.js';
import {
	t
} from './util.i18n.js';
import {
	appendLocalHistory,
	purgeLocalHistory
} from './util.localHistory.js';
// v1.2.0 #9: voice message payload validation + duration formatting
import {
	sanitizeVoicePayload,
	formatVoiceDuration
} from './util.voice.js';
// v1.3.0 #8: whitelisted markdown rendering for text messages
import { markdownToHtml } from './util.markdown.js';

// v1.2.0 #9: render a validated voice payload as an inline audio player.
// data: URL is escaped and javascript: stripped (same treatment as images).
// v1.2.0 #9：把校验过的语音载荷渲染为内嵌音频播放器。data: URL 转义并剥
// javascript:（与图片同等待遇）。
function renderVoiceHtml(v) {
	const src = escapeHTML(v.audio).replace(/javascript:/gi, '');
	return '<span class="voice-wrap"><audio controls preload="metadata" src="' + src + '" class="voice-audio"></audio><span class="voice-dur">🎙 ' + escapeHTML(formatVoiceDuration(v.dur * 1000)) + '</span></span>'
}


// Render the chat area
// 渲染聊天区域
export function renderChatArea() {
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	// P1-B: stale reply/edit state must never leak across rooms
	resetComposerState();
	// v1.1.0: multi-select mode must not leak across rooms either
	exitSelectMode();
	if (activeRoomIndex < 0 || !roomsData[activeRoomIndex]) {
		chatArea.innerHTML = '';
		return
	}
	chatArea.innerHTML = '';
	roomsData[activeRoomIndex].messages.forEach(m => {
		const meta = { id: m.id, reactions: m.reactions, mentions: m.mentions, mentionsMe: m.mentionsMe, quote: m.quote, ttl: m.ttl, edited: m.edited, deleted: m.deleted, burned: m.burned, read: m.read };
		if (m.type === 'me') addMsg(m.text, true, m.msgType || 'text', m.timestamp, meta);
		else if (m.type === 'system') addSystemMsg(m.text, true, m.timestamp);
		else addOtherMsg(m.text, m.userName, m.avatar, true, m.msgType || 'text', m.timestamp, meta)
	})
}

// Add a message to the chat area
// 添加消息到聊天区域
export function addMsg(text, isHistory = false, msgType = 'text', timestamp = null, meta = null) {
	let ts = isHistory ? timestamp : (timestamp || Date.now());
	if (!ts) return;
	if (!isHistory && activeRoomIndex >= 0) {
		const rdMe = roomsData[activeRoomIndex];
		const entryMe = {
			type: 'me',
			text,
			msgType,
			timestamp: ts,
			id: (meta && meta.id) || null,
			reactions: (meta && meta.reactions) || null,
			mentions: (meta && meta.mentions) || null,
			mentionsMe: (meta && meta.mentionsMe) || false,
			author: (rdMe && rdMe.myId) || null,
			quote: (meta && meta.quote) || null,
			ttl: (meta && meta.ttl) || null,
			edited: false,
			deleted: false,
			burned: false
		};
		rdMe.messages.push(entryMe);
		// P3: opt-in encrypted local history (no-op unless enabled + key derived)
		appendLocalHistory(rdMe, {
			type: 'me',
			text,
			msgType,
			timestamp: ts,
			id: (meta && meta.id) || null,
			ttl: (meta && meta.ttl) || null
		})
	}	const chatArea = $id('chat-area');
	if (!chatArea) return;
	let className = 'bubble me' + (msgType.includes('_private') ? ' private-message' : '') + ((meta && meta.mentionsMe) ? ' mentioned' : '');
	const date = new Date(ts);
	const time = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
	// P1-B: tombstone rendering for recalled / burned entries
	const safeMidEarly = (meta && meta.id && /^[A-Za-z0-9]{8,32}$/.test(meta.id)) ? meta.id : null;
	if (safeMidEarly && meta && (meta.deleted || meta.burned)) {
		const tomb = createElement('div', {
			class: className + ' recalled',
			'data-mid': safeMidEarly
		}, `<span class="bubble-content"><span class="msg-recalled">${escapeHTML(t(meta.burned ? 'ui.burned' : 'ui.recalled', meta.burned ? 'Message expired' : 'Message recalled'))}</span></span><span class="bubble-meta">${time}</span>`);
		chatArea.appendChild(tomb);
		chatArea.scrollTop = chatArea.scrollHeight;
		return
	}
	// P1-B: reply-quote block (both fields remote-controlled → escaped)
	const quoteHtml = (meta && meta.quote && meta.quote.x)
		? `<span class="msg-quote"><span class="msg-quote-name">${escapeHTML(String(meta.quote.u || ''))}</span><span class="msg-quote-text">${escapeHTML(String(meta.quote.x).slice(0, 200))}</span></span>`
		: '';
	let contentHtml = '';	if (msgType === 'image' || msgType === 'image_private') {
		// Handle image messages (can contain both text and images)
		if (typeof text === 'object' && text.images && Array.isArray(text.images)) {
			// New multi-image format: {text: "", images: ["data:image...", "data:image..."]}
			const messageText = text.text ? textToHTML(text.text) : '';
			const imageElements = text.images.map(imgData => {
				const safeImgSrc = escapeHTML(imgData).replace(/javascript:/gi, '');
				return `<img src="${safeImgSrc}" alt="image" class="bubble-img">`;
			}).join('');
					if (messageText && imageElements) {
				// Mixed content: text + images
				contentHtml = `<div class="mixed-content">
					<div class="message-text">${messageText}</div>
					${imageElements}
				</div>`;
			} else if (imageElements) {
				// Images only
				contentHtml = imageElements;
			} else {
				// Fallback to text only
				contentHtml = messageText;
			}
		} else if (typeof text === 'object' && text.image) {
			// Legacy single image format: {text: "", image: "data:image..."}
			const safeImgSrc = escapeHTML(text.image).replace(/javascript:/gi, '');
			const messageText = text.text ? textToHTML(text.text) : '';
			
			if (messageText) {
				// Mixed content: text + image
				contentHtml = `<div class="mixed-content">
					<div class="message-text">${messageText}</div>
					<img src="${safeImgSrc}" alt="image" class="bubble-img">
				</div>`;
			} else {
				// Image only
				contentHtml = `<img src="${safeImgSrc}" alt="image" class="bubble-img">`;
			}
		} else {
			// Legacy format: plain image data URL
			const safeImgSrc = escapeHTML(text).replace(/javascript:/gi, '');
			contentHtml = `<img src="${safeImgSrc}" alt="image" class="bubble-img">`;
		}
	} else if (msgType === 'file' || msgType === 'file_private') {
		// Handle file messages
		contentHtml = renderFileMessage(text, true);
		// Add file-bubble class for special timestamp positioning
		className += ' file-bubble';
	} else if (msgType === 'voice' || msgType === 'voice_private') {
		// v1.2.0 #9: own voice echo
		const v = sanitizeVoicePayload(typeof text === 'object' ? text : null);
		contentHtml = v ? renderVoiceHtml(v) : textToHTML('[voice]');
	} else {
		// v1.3.0 #8: markdown rendering (escape-then-wrap, injection-safe)
		contentHtml = markdownToHtml(typeof text === 'string' ? text : '');
		if (meta && meta.mentions && meta.mentions.length) {
			contentHtml = highlightMentionsInHtml(contentHtml, resolveMentionNames(meta.mentions));
		}
	}
	const safeMid = (meta && meta.id && /^[A-Za-z0-9]{8,32}$/.test(meta.id)) ? meta.id : null;
	const actionsHtml = buildMessageActionsHtml(safeMid, {
		isOwnText: msgType === 'text',
		timestamp: ts
	});
	const editedMark = (meta && meta.edited) ? `<span class="msg-edited">${escapeHTML(t('ui.edited', '(edited)'))}</span>` : '';
	const burnMark = (meta && meta.ttl) ? `<span class="msg-burn">🔥${meta.ttl < 60 ? meta.ttl + 's' : (meta.ttl / 60) + 'm'}</span>` : '';
	// P1-C: read-receipt chip on own bubbles, revealed when peers confirm.
	// P1-C: 自己气泡上的已读徽标，对端确认后亮起。
	const readChipHtml = (meta && meta.read)
		? `<span class="msg-read">✓✓</span>`
		: (safeMid ? `<span class="msg-read" hidden>✓✓</span>` : '');
	const div = createElement('div', {
		class: className,
		...(safeMid ? { 'data-mid': safeMid } : {})
	}, `<span class="bubble-content">${quoteHtml}${contentHtml}${editedMark}</span>${actionsHtml}<span class="bubble-meta">${burnMark}${time}${readChipHtml}</span>`);
	chatArea.appendChild(div);
	if (safeMid) renderReactions(safeMid);
	const rdBurn = roomsData[activeRoomIndex];
	if (safeMid && meta && meta.ttl && rdBurn) armBurnTimer(rdBurn, safeMid, meta.ttl, ts);
	chatArea.scrollTop = chatArea.scrollHeight
}
// Add a message from another user to the chat area
// 添加来自其他用户的消息到聊天区域
export function addOtherMsg(msg, userName = '', avatar = '', isHistory = false, msgType = 'text', timestamp = null, meta = null) {
	if (!userName && activeRoomIndex >= 0) {
		const rd = roomsData[activeRoomIndex];
		// 优先使用文件消息自带的 userName 字段
		if (msg && msg.userName) {
			userName = msg.userName;
		} else if (rd && msg && msg.clientId && rd.userMap[msg.clientId]) {
			userName = rd.userMap[msg.clientId].userName || rd.userMap[msg.clientId].username || rd.userMap[msg.clientId].name || t('ui.anonymous', 'Anonymous')
		}
	}
	userName = userName || t('ui.anonymous', 'Anonymous');
	let ts = isHistory ? timestamp : (timestamp || Date.now());
	if (!ts) return;
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	const bubbleWrap = createElement('div', {
		class: 'bubble-other-wrap'
	});	let contentHtml = '';	if (msgType === 'image' || msgType === 'image_private') {
		// Handle image messages (can contain both text and images)
		if (typeof msg === 'object' && msg.images && Array.isArray(msg.images)) {
			// New multi-image format: {text: "", images: ["data:image...", "data:image..."]}
			const messageText = msg.text ? textToHTML(msg.text) : '';
			const imageElements = msg.images.map(imgData => {
				const safeImgSrc = escapeHTML(imgData).replace(/javascript:/gi, '');
				return `<img src="${safeImgSrc}" alt="image" class="bubble-img">`;
			}).join('');
					if (messageText && imageElements) {
				// Mixed content: text + images
				contentHtml = `<div class="mixed-content">
					<div class="message-text">${messageText}</div>
					${imageElements}
				</div>`;
			} else if (imageElements) {
				// Images only
				contentHtml = imageElements;
			} else {
				// Fallback to text only
				contentHtml = messageText;
			}
		} else if (typeof msg === 'object' && msg.image) {
			// Legacy single image format: {text: "", image: "data:image..."}
			const safeImgSrc = escapeHTML(msg.image).replace(/javascript:/gi, '');
			const messageText = msg.text ? textToHTML(msg.text) : '';
			
			if (messageText) {
				// Mixed content: text + image
				contentHtml = `<div class="mixed-content">
					<div class="message-text">${messageText}</div>
					<img src="${safeImgSrc}" alt="image" class="bubble-img">
				</div>`;
			} else {
				// Image only
				contentHtml = `<img src="${safeImgSrc}" alt="image" class="bubble-img">`;
			}
		} else {
			// Legacy format: plain image data URL
			const safeImgSrc = escapeHTML(msg).replace(/javascript:/gi, '');
			contentHtml = `<img src="${safeImgSrc}" alt="image" class="bubble-img">`;
		}
	} else if (msgType === 'file' || msgType === 'file_private') {
		// Handle file messages
		contentHtml = renderFileMessage(msg, false);
	} else if (msgType === 'voice' || msgType === 'voice_private') {
		// v1.2.0 #9: incoming voice message
		const v = sanitizeVoicePayload(typeof msg === 'object' ? msg : null);
		contentHtml = v ? renderVoiceHtml(v) : textToHTML('[voice]');
	} else {
		// v1.3.0 #8: markdown rendering (escape-then-wrap, injection-safe)
		contentHtml = markdownToHtml(typeof msg === 'string' ? msg : '');
		if (meta && meta.mentions && meta.mentions.length) {
			contentHtml = highlightMentionsInHtml(contentHtml, resolveMentionNames(meta.mentions));
		}
	}
	const safeMid = (meta && meta.id && /^[A-Za-z0-9]{8,32}$/.test(meta.id)) ? meta.id : null;
	const safeUserName = escapeHTML(userName);
	const date = new Date(ts);
	const time = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
	// P1-B: tombstone rendering for recalled / burned entries
	if (safeMid && meta && (meta.deleted || meta.burned)) {
		const tombWrap = createElement('div', { class: 'bubble-other-wrap' });
		tombWrap.innerHTML = `<span class="avatar"></span><div class="bubble-other-main"><div class="bubble other recalled" data-mid="${safeMid}"><div class="bubble-other-name">${safeUserName}</div><span class="bubble-content"><span class="msg-recalled">${escapeHTML(t(meta.burned ? 'ui.burned' : 'ui.recalled', meta.burned ? 'Message expired' : 'Message recalled'))}</span></span><span class="bubble-meta">${time}</span></div></div>`;
		const tombAvatar = $('.avatar', tombWrap);
		if (tombAvatar) {
			const cleanSvg = createAvatarSVG(userName).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
			tombAvatar.innerHTML = cleanSvg
		}
		chatArea.appendChild(tombWrap);
		chatArea.scrollTop = chatArea.scrollHeight;
		return
	}
	// P1-B: reply-quote block (both fields remote-controlled → escaped)
	const quoteHtml = (meta && meta.quote && meta.quote.x)
		? `<span class="msg-quote"><span class="msg-quote-name">${escapeHTML(String(meta.quote.u || ''))}</span><span class="msg-quote-text">${escapeHTML(String(meta.quote.x).slice(0, 200))}</span></span>`
		: '';
	const actionsHtml = buildMessageActionsHtml(safeMid, {
		isOwnText: false,
		timestamp: ts
	});
	let bubbleClasses = 'bubble other';
	if (msgType && msgType.includes('_private')) {
		bubbleClasses += ' private-message'
	}
	if (msgType === 'file' || msgType === 'file_private') {
		bubbleClasses += ' file-bubble';
	}
	if (meta && meta.mentionsMe) {
		bubbleClasses += ' mentioned';
	}
	bubbleWrap.innerHTML = `<span class="avatar"></span><div class="bubble-other-main"><div class="${bubbleClasses}"${safeMid ? ` data-mid="${safeMid}"` : ''}><div class="bubble-other-name">${safeUserName}</div><span class="bubble-content">${quoteHtml}${contentHtml}</span>${actionsHtml}<span class="bubble-meta">${(meta && meta.ttl) ? `<span class="msg-burn">🔥${meta.ttl < 60 ? meta.ttl + 's' : (meta.ttl / 60) + 'm'}</span>` : ''}${time}</span></div></div>`;
	const svg = createAvatarSVG(userName);
	const avatarEl = $('.avatar', bubbleWrap);
	if (avatarEl) {
		const cleanSvg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		avatarEl.innerHTML = cleanSvg
	}
	chatArea.appendChild(bubbleWrap);
	if (safeMid) renderReactions(safeMid);
	chatArea.scrollTop = chatArea.scrollHeight
}

// Add a system message to the chat area
// 添加系统消息到聊天区域
export function addSystemMsg(text, isHistory = false, timestamp = null) {
	if (!isHistory && activeRoomIndex >= 0) {
		const ts = timestamp || Date.now();
		roomsData[activeRoomIndex].messages.push({
			type: 'system',
			text,
			timestamp: ts
		})
	}
	const chatArea = $id('chat-area');
	if (!chatArea) return;
	const safeText = textToHTML(text);
	const div = createElement('div', {
		class: 'bubble system'
	}, `<span class="bubble-content">${safeText}</span>`);
	chatArea.appendChild(div);
	chatArea.scrollTop = chatArea.scrollHeight
}

// Update the style of the chat input area
// 更新聊天输入区域的样式
export function updateChatInputStyle() {
	const rd = roomsData[activeRoomIndex];
	const chatInputArea = $('.chat-input-area');
	const placeholder = $('.input-field-placeholder');
	const inputMessageInput = $('.input-message-input');
	if (!chatInputArea || !placeholder || !inputMessageInput) return;	if (rd && rd.privateChatTargetId) {
		addClass(chatInputArea, 'private-mode');
		addClass(inputMessageInput, 'private-mode');
		placeholder.textContent = `${t('ui.private_message_to', 'Private Message to')} ${escapeHTML(rd.privateChatTargetName)}`
	} else {
		removeClass(chatInputArea, 'private-mode');
		removeClass(inputMessageInput, 'private-mode');
		placeholder.textContent = t('ui.message', 'Message')
	}
	const html = inputMessageInput.innerHTML.replace(/<br\s*\/?>(\s*)?/gi, '').replace(/&nbsp;/g, '').replace(/\u200B/g, '').trim();
	placeholder.style.opacity = (html === '') ? '1' : '0'
	// v1.5.0 #16: the call button is visible only with a private-chat target.
	// Hook is set by main.js (avoids a chat.js → call-manager import cycle).
	// v1.5.0 #16：通话按钮仅在有私聊对象时可见。钩子由 main.js 设置
	//（避免 chat.js → 通话管理器的导入环）。
	if (window.__jmltUpdateCallBtn) {
		try { window.__jmltUpdateCallBtn() } catch (_e) { /* best-effort */ }
	}
}

// Setup image preview functionality
// 设置图片预览功能
export function setupImagePreview() {
	on($id('chat-area'), 'click', function(e) {
		const target = e.target;
		if (target.tagName === 'IMG' && target.closest('.bubble-content')) {
			showImageModal(target.src)
		}
	})
}

// Show the image modal
// 显示图片模态框
export function showImageModal(src) {
	const modal = createElement('div', {
		class: 'img-modal-bg'
	}, `<div class="img-modal-blur"></div><div class="img-modal-content img-modal-content-overflow"><img src="${src}"class="img-modal-img"/><span class="img-modal-close">&times;</span></div>`);
	document.body.appendChild(modal);
	on($('.img-modal-close', modal), 'click', () => modal.remove());
	on(modal, 'click', (e) => {
		if (e.target === modal) modal.remove()
	});
	const img = $('img', modal);
	let scale = 1;
	let isDragging = false;
	let lastX = 0,
		lastY = 0;
	let offsetX = 0,
		offsetY = 0;
	img.ondragstart = function(e) {
		e.preventDefault()
	};
	on(img, 'wheel', function(ev) {
		ev.preventDefault();
		const prevScale = scale;
		scale += ev.deltaY < 0 ? 0.1 : -0.1;
		scale = Math.max(0.2, Math.min(5, scale));
		if (scale === 1) {
			offsetX = 0;
			offsetY = 0
		}
		updateTransform()
	});

	function updateTransform() {
		img.style.transform = `translate(${offsetX}px,${offsetY}px)scale(${scale})`;
		img.style.cursor = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in'
	}
	on(img, 'mousedown', function(ev) {
		if (scale <= 1) return;
		isDragging = true;
		lastX = ev.clientX;
		lastY = ev.clientY;
		img.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none'
	});

	function onMouseMove(ev) {
		if (!isDragging) return;
		offsetX += ev.clientX - lastX;
		offsetY += ev.clientY - lastY;
		lastX = ev.clientX;
		lastY = ev.clientY;
		updateTransform()
	}

	function onMouseUp() {
		if (isDragging) {
			isDragging = false;
			img.style.cursor = 'grab';
			document.body.style.userSelect = ''
		}
	}
	on(window, 'mousemove', onMouseMove);
	on(window, 'mouseup', onMouseUp);
	on(img, 'dblclick', function() {
		scale = 1;
		offsetX = 0;
		offsetY = 0;
		updateTransform()
	});
	const cleanup = () => {
		off(window, 'mousemove', onMouseMove);
		off(window, 'mouseup', onMouseUp);
		document.body.style.userSelect = ''
	};
	on(modal, 'remove', cleanup);
	on($('.img-modal-close', modal), 'click', cleanup);
	updateTransform()
}

// Render file message content
// 渲染文件消息内容
function renderFileMessage(fileData, isSender) {
	const {
		fileId,
		fileName,
		originalSize,
		totalVolumes,
		fileCount,
		isArchive
	} = fileData;

	// SECURITY: fileId comes from the remote peer and is interpolated into HTML
	// attributes and an inline handler. Whitelist it before any interpolation.
	const safeFileId = String(fileId || '').replace(/[^A-Za-z0-9_-]/g, '');
	const safeFileIdAttr = escapeHTML(safeFileId);
	const transfer = window.fileTransfers ? window.fileTransfers.get(safeFileId) : null;
	
	// For archive files, show file count and total size
	let displayName, displayMeta;
	if (isArchive && fileCount) {
		// 使用 i18n，保持原格式
		displayName = `${fileCount}${t('file.files', ' files')}`;
		displayMeta = `${t('file.total', 'Total')}: ${formatFileSize(originalSize)}`;
	} else {
		displayName = fileName;
		displayMeta = formatFileSize(originalSize);
	}
	
	const safeDisplayName = escapeHTML(displayName);

	// Check actual file transfer status
	let statusText = '';
	let progressWidth = '0%';
	let downloadBtnStyle = 'display: none;';
	let showProgress = false;
	
	if (transfer) {
		if (transfer.status === 'sending') {
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			progressWidth = `${progress}%`;
			statusText = `Sending ${transfer.sentVolumes}/${transfer.totalVolumes}`;
			showProgress = true;
		} else if (transfer.status === 'receiving' || transfer.status === 'incomplete') {
			const progress = (transfer.receivedVolumes.size / transfer.totalVolumes) * 100;
			progressWidth = `${progress}%`;
			statusText = transfer.status === 'incomplete'
				? t('file.waiting_resume', 'Waiting for re-send…')
				: `Receiving ${transfer.receivedVolumes.size}/${transfer.totalVolumes}`;
			showProgress = true;
		} else if (transfer.status === 'completed') {
			// 完成时不显示任何状态，只显示下载按钮
			downloadBtnStyle = isSender ? 'display: none;' : 'display: flex;';
		}	} else if (isSender) {
		// 发送方历史消息，不显示状态和下载按钮
		downloadBtnStyle = 'display: none;';
	} else {
		// 接收方历史消息，直接显示下载按钮（带动画效果）
		downloadBtnStyle = 'display: flex;';
	}
	// Different icon for archives vs single files
	const fileIcon = isArchive ? '📦' : '📄';

	return `
		<div class="file-message" data-file-id="${safeFileIdAttr}">
			<div class="file-main-content">
				<div class="file-info">
					<div class="file-icon">${fileIcon}</div>
					<div class="file-details">
						<div class="file-name" title="${safeDisplayName}">${safeDisplayName}</div>
						<div class="file-meta">${displayMeta}</div>
					</div>
				</div>
				<button class="file-download-btn show" style="${downloadBtnStyle}" type="button" aria-label="download">
					<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"></g><g stroke-linecap="round" stroke-linejoin="round"></g><g> <path fill-rule="evenodd" clip-rule="evenodd" d="M8 10C8 7.79086 9.79086 6 12 6C14.2091 6 16 7.79086 16 10V11H17C18.933 11 20.5 12.567 20.5 14.5C20.5 16.433 18.933 18 17 18H16.9C16.3477 18 15.9 18.4477 15.9 19C15.9 19.5523 16.3477 20 16.9 20H17C20.0376 20 22.5 17.5376 22.5 14.5C22.5 11.7793 20.5245 9.51997 17.9296 9.07824C17.4862 6.20213 15.0003 4 12 4C8.99974 4 6.51381 6.20213 6.07036 9.07824C3.47551 9.51997 1.5 11.7793 1.5 14.5C1.5 17.5376 3.96243 20 7 20H7.1C7.65228 20 8.1 19.5523 8.1 19C8.1 18.4477 7.65228 18 7.1 18H7C5.067 18 3.5 16.433 3.5 14.5C3.5 12.567 5.067 11 7 11H8V10ZM13 11C13 10.4477 12.5523 10 12 10C11.4477 10 11 10.4477 11 11V16.5858L9.70711 15.2929C9.31658 14.9024 8.68342 14.9024 8.29289 15.2929C7.90237 15.6834 7.90237 16.3166 8.29289 16.7071L11.2929 19.7071C11.6834 20.0976 12.3166 20.0976 12.7071 19.7071L15.7071 16.7071C16.0976 16.3166 16.0976 15.6834 15.7071 15.2929C15.3166 14.9024 14.6834 14.9024 14.2929 15.2929L13 16.5858V11Z" fill="currentColor"></path> </g></svg>
				</button>
			</div>
			${showProgress ? `<div class="file-progress-container">
				<div class="file-progress-bar">
					<div class="file-progress" style="width: ${progressWidth}"></div>
				</div>
				<div class="file-status">${statusText}</div>
			</div>` : ''}
		</div>
	`;
}

// Automatically adjust the height of the input area
// 自动调整输入区域的高度
export function autoGrowInput() {
	const input = $('.input-message-input');
	if (!input) return;
	input.style.height = 'auto';
	input.style.height = input.scrollHeight + 'px'
}

// Handle pasting text as plain text
// 处理粘贴为纯文本
function handlePasteAsPlainText(element) {
	if (!element) return;
	on(element, 'paste', function(e) {
		e.preventDefault();
		let text = '';
		if (e.clipboardData || window.clipboardData) {
			text = (e.clipboardData || window.clipboardData).getData('text/plain')
		}
		if (document.queryCommandSupported('insertText')) {
			document.execCommand('insertText', false, text)
		} else {
			const selection = window.getSelection();
			if (selection.rangeCount) {
				const range = selection.getRangeAt(0);
				range.deleteContents();
				const textNode = document.createTextNode(text);
				range.insertNode(textNode);
				range.setStartAfter(textNode);
				range.setEndAfter(textNode);
				selection.removeAllRanges();
				selection.addRange(range)
			}
		}
	})
}

// Setup input placeholder functionality
// 设置输入框占位符功能
export function setupInputPlaceholder() {
	const input = $('.input-message-input');
	const placeholder = $('.input-field-placeholder');
	if (!input || !placeholder) return;

	function checkEmpty() {
		const html = input.innerHTML.replace(/<br\s*\/?>(\s*)?/gi, '').replace(/&nbsp;/g, '').replace(/\u200B/g, '').trim();
		if (html === '') {
			placeholder.style.opacity = '1'
		} else {
			placeholder.style.opacity = '0'
		}
		autoGrowInput()
	}
	on(input, 'input', checkEmpty);
	on(input, 'blur', checkEmpty);
	on(input, 'focus', checkEmpty);
	handlePasteAsPlainText(input);
	checkEmpty();
	autoGrowInput();
	updateChatInputStyle()
}

// ==================== P1 conveniences: emoji reactions + @mentions ====================
// P1 便利功能：表情回应 + @提及
// SECURITY: everything below travels inside the existing E2EE content layer.
// The server only ever relays opaque ciphertext and is completely unchanged.

// Whitelisted reaction emojis (rendered as text nodes, still escaped upstream)
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// Resolve clientIds -> display names for mention highlighting
// 将 clientId 列表解析为显示名（用于高亮）
function resolveMentionNames(mentions) {
	const rd = roomsData[activeRoomIndex];
	const names = [];
	if (!rd || !Array.isArray(mentions)) return names;
	for (const cid of mentions) {
		const u = rd.userMap && rd.userMap[cid];
		const name = u ? (u.userName || u.username || u.name || '') : '';
		if (name && names.indexOf(name) === -1) names.push(name)
	}
	return names
}

// Wrap @Name tokens in sanitized HTML with .mention spans.
// Runs AFTER DOMPurify: our injected span only contains escaped text.
// 在 DOMPurify 之后注入 .mention span（内容为转义文本，安全）
function highlightMentionsInHtml(html, names) {
	if (!html || !names || !names.length) return html;
	for (const name of names) {
		const esc = escapeHTML(name);
		if (!esc) continue;
		html = html.split('@' + esc).join('<span class="mention">@' + esc + '</span>')
	}
	return html
}

// Find a message entry by id in the active room
function findMessageById(rd, mid) {
	return rd.messages.find(m => m.id === mid) || null
}

// Toggle a reaction locally (no network). clientId empty = own reaction.
// 本地切换回应状态（不发网络请求）
export function toggleReactionLocal(rd, mid, emoji, clientId) {
	if (!rd || !mid || !emoji) return false;
	const msg = findMessageById(rd, mid);
	if (!msg) return false;
	if (!msg.reactions || typeof msg.reactions !== 'object') msg.reactions = {};
	const list = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji] : (msg.reactions[emoji] = []);
	const idx = list.indexOf(clientId);
	if (idx === -1) list.push(clientId);
	else list.splice(idx, 1);
	if (list.length === 0) delete msg.reactions[emoji];
	return true
}

// Re-render the reaction chips row under a message
// 重绘某条消息下方的回应栏
export function renderReactions(mid) {
	const rd = roomsData[activeRoomIndex];
	if (!rd || !mid || !/^[A-Za-z0-9]{8,32}$/.test(mid)) return;
	const row = document.querySelector('#chat-area .msg-reactions[data-mid="' + mid + '"]');
	if (!row) return;
	const msg = findMessageById(rd, mid);
	if (!msg || !msg.reactions || !Object.keys(msg.reactions).length) {
		row.innerHTML = '';
		return
	}
	let html = '';
	for (const emoji in msg.reactions) {
		const clients = msg.reactions[emoji];
		if (!Array.isArray(clients) || !clients.length) continue;
		const names = clients.map(cid => {
			const u = rd.userMap && rd.userMap[cid];
			return (u && (u.userName || u.username || u.name)) || t('ui.anonymous', 'Anonymous')
		});
		const mine = rd.myId && clients.indexOf(rd.myId) !== -1;
		// emoji + names are escaped before interpolation (RULES.md invariant 5)
		html += `<span class="msg-reaction-chip${mine ? ' mine' : ''}" data-emoji="${escapeHTML(emoji)}" title="${escapeHTML(names.join(', '))}">${escapeHTML(emoji)} ${clients.length}</span>`
	}
	row.innerHTML = html
}

// Floating emoji picker for reactions
// 表情回应浮动选框
function showReactionPicker(mid, anchorEl) {
	hideReactionPicker();
	const picker = createElement('div', { class: 'reaction-picker', 'data-mid': mid });
	picker.innerHTML = REACTION_EMOJIS.map(e =>
		`<button type="button" class="reaction-option" data-emoji="${escapeHTML(e)}">${escapeHTML(e)}</button>`
	).join('');
	document.body.appendChild(picker);
	const rect = anchorEl.getBoundingClientRect();
	const pw = 216, ph = 44;
	picker.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, rect.left - pw / 2)) + 'px';
	picker.style.top = Math.max(8, rect.top - ph - 8) + 'px';
	setTimeout(() => {
		on(document, 'click', hideReactionPickerOnOutside)
	}, 0)
}

function hideReactionPickerOnOutside(e) {
	const picker = document.querySelector('.reaction-picker');
	if (!picker) return;
	if (picker.contains(e.target)) return;
	hideReactionPicker()
}

function hideReactionPicker() {
	const picker = document.querySelector('.reaction-picker');
	if (picker) picker.remove();
	off(document, 'click', hideReactionPickerOnOutside)
}

// Delegated handlers on the chat area (attached once)
// 聊天区事件委托（只挂一次）
export function setupReactionsUI() {
	const chatArea = $id('chat-area');
	if (!chatArea || chatArea.dataset.reactionsSetup === '1') return;
	chatArea.dataset.reactionsSetup = '1';
	on(chatArea, 'click', function(e) {
		const rd = roomsData[activeRoomIndex];
		if (!rd || !rd.chat) return;
		const reactBtn = e.target.closest('.msg-react-btn');
		if (reactBtn) {
			e.stopPropagation();
			showReactionPicker(reactBtn.dataset.mid, reactBtn);
			return
		}
		// ---- P1-B: reply / edit / recall / bar cancel ----
		const replyBtn = e.target.closest('.msg-reply-btn');
		if (replyBtn) {
			e.stopPropagation();
			const rd2 = roomsData[activeRoomIndex];
			if (rd2 && replyBtn.dataset.mid) startReply(rd2, replyBtn.dataset.mid);
			return
		}
		const editBtn = e.target.closest('.msg-edit-btn');
		if (editBtn) {
			e.stopPropagation();
			const rd2 = roomsData[activeRoomIndex];
			if (rd2 && editBtn.dataset.mid) startEdit(rd2, editBtn.dataset.mid);
			return
		}
		const delBtn = e.target.closest('.msg-del-btn');
		if (delBtn) {
			e.stopPropagation();
			const rd2 = roomsData[activeRoomIndex];
			const mid = delBtn.dataset.mid;
			if (!rd2 || !mid || !rd2.chat) return;
			if (!window.confirm(t('ui.confirm_recall', 'Recall this message?'))) return;
			if (rd2.chat.sendDelete(mid)) {
				recallMessageLocal(rd2, mid)
			}
			return
		}
		const barCancel = e.target.closest('.jmlt-bar-cancel');
		if (barCancel) {
			e.stopPropagation();
			if (barCancel.dataset.bar === 'edit') pendingEdit = null;
			else pendingReply = null;
			renderActionBars();
			return
		}
		const chip = e.target.closest('.msg-reaction-chip');
		if (chip) {
			e.stopPropagation();
			const bubble = chip.closest('[data-mid]');
			if (!bubble) return;
			const mid = bubble.dataset.mid;
			const emoji = chip.dataset.emoji || '';
			if (!mid || !emoji) return;
			if (rd.chat.sendReaction(mid, emoji)) {
				toggleReactionLocal(rd, mid, emoji, rd.myId);
				renderReactions(mid)
			}
			return
		}
		const option = e.target.closest('.reaction-option');
		if (option) {
			e.stopPropagation();
			const picker = option.closest('.reaction-picker');
			const mid = picker ? picker.dataset.mid : null;
			const emoji = option.dataset.emoji || '';
			hideReactionPicker();
			if (!mid || !emoji) return;
			if (rd.chat.sendReaction(mid, emoji)) {
				toggleReactionLocal(rd, mid, emoji, rd.myId);
				renderReactions(mid)
			}
		}
	})
}
// ==================== P2: typing indicator ====================
// 输入中指示器。渲染当前房间正在输入的成员名（全部转义后插入）。
// Update the "X is typing…" indicator for the active room.
// usernames: array of raw usernames currently typing (already filtered).
export function updateTypingIndicator(usernames) {
	const inputArea = document.querySelector('.chat-input-area');
	if (!inputArea) return;
	let el = document.getElementById('typing-indicator');
	if (!usernames || usernames.length === 0) {
		if (el) el.remove();
		return
	}
	if (!el) {
		el = createElement('div', {
			id: 'typing-indicator',
			class: 'typing-indicator'
		});
		inputArea.parentNode.insertBefore(el, inputArea)
	}
	// SECURITY: usernames originate from remote peers — escapeHTML before any
	// HTML interpolation (same rule as member list).
	const names = usernames.slice(0, 3).map(u => escapeHTML(u || '')).join(', ');
	const more = usernames.length > 3 ? t('ui.typing_more', ' and others') : '';
	el.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span><span class="typing-names">${names}${more}</span> ${t('ui.typing', 'is typing…')}`
}

// ==================== P2: per-room local drafts ====================
// 本地草稿。SECURITY/RULES.md 对照：
// - 只存用户自己输入的消息文本，绝不存密码/密钥素材（不变量 4）
// - 用 sessionStorage：作用域仅当前标签页会话，关标签即焚
// - key 用频道哈希（sha256 hex，客户端自算），房间名不上存储
function draftKey(channelHash) {
	const safe = String(channelHash || '');
	return /^[0-9a-f]{64}$/.test(safe) ? 'jmlt_draft:' + safe : null
}

function isBlankHtml(html) {
	return !html || html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, '').replace(/\u200B/g, '').trim() === ''
}

export function saveDraft(channelHash, html) {
	const key = draftKey(channelHash);
	if (!key) return;
	try {
		if (isBlankHtml(html)) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, html)
	} catch (error) { /* storage unavailable — draft is best-effort */ }
}

export function loadDraft(channelHash) {
	const key = draftKey(channelHash);
	if (!key) return '';
	try {
		return sessionStorage.getItem(key) || ''
	} catch (error) {
		return ''
	}
}

export function clearDraft(channelHash) {
	const key = draftKey(channelHash);
	if (!key) return;
	try {
		sessionStorage.removeItem(key)
	} catch (error) { /* noop */ }
}

// ==================== P1-B: reply / edit / recall / burn-after-timer ====================
// 回复引用 / 编辑 / 撤回 / 定时焚毁。SECURITY/RULES.md 对照：
// - 全部走既有 E2EE 内容层（'w' 信封内的 'edit'/'del' action），服务器盲转发、零改动
// - 接收端校验发起者 = 原作者（author clientId），防同房成员伪造撤回/编辑
// - 编辑时限 15 分钟，双端校验；撤回/焚毁后同步从加密本地历史中剔除（不可复活）
// - 引用块字段（q.u/q.x）全部 escapeHTML 后插入（不变量 5）

const EDIT_WINDOW_MS = 15 * 60 * 1000;

// Module state (per-tab): reply target, editing target, burn timer mode
let pendingReply = null; // { id, name, snippet, scope }
let pendingEdit = null;  // { id }
let burnTtl = 0;         // 0 | 30 | 300 | 3600 (seconds)

export function getPendingReply() { return pendingReply }
export function clearPendingReply() {
	pendingReply = null;
	renderActionBars()
}
export function getPendingEdit() { return pendingEdit }
export function clearPendingEdit() {
	pendingEdit = null;
	renderActionBars()
}
export function getBurnTtl() { return burnTtl }

// Clear transient composer states (used when switching rooms so a stale
// reply/edit never leaks across rooms)
export function resetComposerState() {
	pendingReply = null;
	pendingEdit = null;
	const rb = document.getElementById('jmlt-reply-bar');
	if (rb) rb.remove();
	const eb = document.getElementById('jmlt-edit-bar');
	if (eb) eb.remove()
}

// Action buttons row for a bubble (function declaration — hoisted, used above)
// 气泡操作按钮排（函数声明提升，供上方调用）
function buildMessageActionsHtml(safeMid, opts) {
	if (!safeMid) return '';
	const isOwnText = !!(opts && opts.isOwnText);
	const ts = (opts && opts.timestamp) || Date.now();
	const editOpen = isOwnText && (Date.now() - ts) < EDIT_WINDOW_MS;
	return `<span class="bubble-actions">` +
		`<button type="button" class="msg-act-btn msg-reply-btn" data-mid="${safeMid}" title="${escapeHTML(t('ui.reply', 'Reply'))}">↩</button>` +
		(editOpen ? `<button type="button" class="msg-act-btn msg-edit-btn" data-mid="${safeMid}" title="${escapeHTML(t('ui.edit', 'Edit'))}">✏</button>` : '') +
		(editOpen ? `<button type="button" class="msg-act-btn msg-del-btn" data-mid="${safeMid}" title="${escapeHTML(t('ui.delete', 'Recall'))}">🗑</button>` : '') +
		`<button type="button" class="msg-react-btn" data-mid="${safeMid}" aria-label="react">😊+</button>` +
		`</span><span class="msg-reactions" data-mid="${safeMid}"></span>`
}

// Arm (or re-arm) the local burn timer for a message entry. Re-arming on
// history re-render uses the remaining time, so timers survive room switches.
// 为消息条目布置本地焚毁定时器；历史重渲染时按剩余时间重排。
export function armBurnTimer(rd, mid, ttl, ts) {
	if (!rd || !mid || !ttl) return;
	const entry = findMessageById(rd, mid);
	if (!entry || entry.burned || entry.deleted) return;
	if (entry._burnTimer) {
		clearTimeout(entry._burnTimer);
		entry._burnTimer = null
	}
	const remaining = ttl * 1000 - (Date.now() - (ts || entry.timestamp || Date.now()));
	entry._burnTimer = setTimeout(() => burnMessageLocal(rd, mid), Math.max(0, remaining))
}

// Replace a bubble's DOM with a tombstone (recalled / burned)
// 将气泡替换为占位标记
function recallBubbleDom(mid, label) {
	const bubble = document.querySelector('#chat-area [data-mid="' + mid + '"]');
	if (!bubble) return;
	bubble.classList.add('recalled');
	bubble.innerHTML = `<span class="bubble-content"><span class="msg-recalled">${escapeHTML(label)}</span></span>`
}

// Locally burn a message (timer expiry). Also purged from encrypted local
// history so it cannot be resurrected on rejoin.
// 本地焚毁消息（定时器到期），并同步从加密本地历史剔除。
export function burnMessageLocal(rd, mid) {
	if (!rd || !mid || !/^[A-Za-z0-9]{8,32}$/.test(mid)) return false;
	const entry = findMessageById(rd, mid);
	if (!entry || entry.burned || entry.deleted) return false;
	entry.burned = true;
	entry.text = null;
	if (entry._burnTimer) {
		clearTimeout(entry._burnTimer);
		entry._burnTimer = null
	}
	purgeLocalHistory(rd, e => e && e.id === mid);
	recallBubbleDom(mid, t('ui.burned', 'Message expired'));
	return true
}

// Locally recall a message (sender action confirmed, or verified remote del)
// 本地撤回消息
export function recallMessageLocal(rd, mid) {
	if (!rd || !mid || !/^[A-Za-z0-9]{8,32}$/.test(mid)) return false;
	const entry = findMessageById(rd, mid);
	if (!entry || entry.burned || entry.deleted) return false;
	entry.deleted = true;
	entry.text = null;
	if (entry._burnTimer) {
		clearTimeout(entry._burnTimer);
		entry._burnTimer = null
	}
	purgeLocalHistory(rd, e => e && e.id === mid);
	recallBubbleDom(mid, t('ui.recalled', 'Message recalled'));
	return true
}

// Apply a verified edit to a message entry + its bubble DOM.
// 应用已验证的编辑到消息条目与气泡 DOM。
export function applyEditLocal(rd, mid, text, mentions) {
	if (!rd || !mid || !/^[A-Za-z0-9]{8,32}$/.test(mid)) return false;
	const entry = findMessageById(rd, mid);
	if (!entry || entry.burned || entry.deleted) return false;
	if (Date.now() - (entry.timestamp || 0) > EDIT_WINDOW_MS) return false;
	entry.text = text;
	entry.edited = true;
	if (Array.isArray(mentions) && mentions.length) entry.mentions = mentions;
	// keep encrypted local history honest: replace the stale entry
	purgeLocalHistory(rd, e => e && e.id === mid);
	appendLocalHistory(rd, {
		type: entry.type,
		text,
		msgType: entry.msgType,
		timestamp: entry.timestamp,
		id: mid,
		edited: true
	});
	const bubble = document.querySelector('#chat-area [data-mid="' + mid + '"]');
	if (bubble) {
		const contentEl = bubble.querySelector('.bubble-content');
		if (contentEl) {
			let html = textToHTML(text);
			if (Array.isArray(mentions) && mentions.length) {
				html = highlightMentionsInHtml(html, resolveMentionNames(mentions))
			}
			contentEl.innerHTML = html + `<span class="msg-edited">${escapeHTML(t('ui.edited', '(edited)'))}</span>`
		}
	}
	return true
}

// Start a reply to a message (composer bar above the input area)
// 发起回复（输入区上方的引用条）
function startReply(rd, mid) {
	const entry = findMessageById(rd, mid);
	if (!entry || entry.burned || entry.deleted) return;
	const name = entry.type === 'me' ? (rd.myUserName || '') : (entry.userName || '');
	let snippet = '…';
	if (typeof entry.text === 'string') snippet = entry.text.slice(0, 200);
	else if (entry.msgType && entry.msgType.indexOf('image') === 0) snippet = '🖼';
	else if (entry.msgType && entry.msgType.indexOf('file') === 0) snippet = '📎';
	pendingEdit = null;
	pendingReply = {
		id: mid,
		name,
		snippet,
		scope: (entry.msgType && entry.msgType.indexOf('_private') !== -1) ? 'private' : 'public'
	};
	renderActionBars()
}

// Start editing one of my own public text messages (loads text into composer)
// 编辑自己的公共文本消息（载入输入框）
function startEdit(rd, mid) {
	const entry = findMessageById(rd, mid);
	if (!entry || entry.burned || entry.deleted) return;
	if (entry.msgType !== 'text') return;
	if (Date.now() - (entry.timestamp || 0) > EDIT_WINDOW_MS) return;
	if (typeof entry.text !== 'string') return;
	pendingReply = null;
	pendingEdit = { id: mid };
	const inputEl = document.querySelector('.input-message-input');
	if (inputEl) {
		inputEl.innerText = entry.text;
		inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		inputEl.focus()
	}
	renderActionBars()
}

// Render the reply/edit bar above the input area (creates/removes as needed)
// 渲染输入区上方的回复/编辑条
function renderActionBars() {
	const rb = document.getElementById('jmlt-reply-bar');
	if (rb) rb.remove();
	const eb = document.getElementById('jmlt-edit-bar');
	if (eb) eb.remove();
	const rd = roomsData[activeRoomIndex];
	if (!rd) return;
	if (pendingEdit) {
		const bar = createElement('div', { id: 'jmlt-edit-bar', class: 'jmlt-action-bar' });
		bar.innerHTML = `<span class="jmlt-bar-label">✏ ${escapeHTML(t('ui.editing_msg', 'Editing message'))}</span><button type="button" class="jmlt-bar-cancel" data-bar="edit">${escapeHTML(t('ui.cancel', 'Cancel'))}</button>`;
		const inputArea = document.querySelector('.chat-input-area');
		if (inputArea && inputArea.parentNode) inputArea.parentNode.insertBefore(bar, inputArea)
	} else if (pendingReply) {
		const bar = createElement('div', { id: 'jmlt-reply-bar', class: 'jmlt-action-bar' });
		bar.innerHTML = `<span class="jmlt-bar-label">↩ <b>${escapeHTML(pendingReply.name || '')}</b> ${escapeHTML(String(pendingReply.snippet || '').slice(0, 120))}</span><button type="button" class="jmlt-bar-cancel" data-bar="reply">${escapeHTML(t('ui.cancel', 'Cancel'))}</button>`;
		const inputArea = document.querySelector('.chat-input-area');
		if (inputArea && inputArea.parentNode) inputArea.parentNode.insertBefore(bar, inputArea)
	}
}

// Burn-timer toggle button in the composer (off → 30s → 5m → 1h → off)
// 输入区的焚毁定时切换按钮（关 → 30s → 5m → 1h → 关）
export function setupBurnBtn() {
	const btn = document.querySelector('.chat-burn-btn');
	if (!btn || btn.dataset.burnSetup === '1') return;
	btn.dataset.burnSetup = '1';
	const labels = { 0: '⏱', 30: '⏱30s', 300: '⏱5m', 3600: '⏱1h' };
	on(btn, 'click', () => {
		burnTtl = burnTtl === 0 ? 30 : burnTtl === 30 ? 300 : burnTtl === 300 ? 3600 : 0;
		btn.textContent = labels[burnTtl];
		btn.classList.toggle('active', burnTtl !== 0);
		btn.title = burnTtl
			? '🔥 ' + (burnTtl < 60 ? burnTtl + 's' : (burnTtl / 60) + 'm')
			: t('ui.burn_off', 'Burn timer: off')
	})
}

// ==================== P1-C: read receipts ====================
// 已读回执。原则（RULES.md 对照）：
// - 只在窗口「可见 + 聚焦」时把看过的消息 id 排队上报——不看就是没读
// - 700ms 防抖合并批量发送，上限 50 条/批
// - 纯 id 信号，走 E2EE 内容层，服务器盲转发

let readReceiptSender = null;      // injected by main.js: (ids) => chat.sendReadReceipts(ids)
const pendingReadIds = new Set();
let readFlushTimer = null;

// main.js 注入实际发送函数（解耦 chat.js 与 NodeCrypt）
export function setReadReceiptSender(fn) {
	readReceiptSender = typeof fn === 'function' ? fn : null
}

// Queue a message id as "seen". Callers must check visibility themselves or
// use isWindowReading(), kept here so the rule lives in one place.
// 排队一条「已看」消息 id。可见性判断集中在本模块，规则只写一遍。
export function isWindowReading() {
	try {
		return document.visibilityState === 'visible' && document.hasFocus();
	} catch (_e) {
		return false
	}
}

export function queueReadReceipt(mid) {
	const id = String(mid || '');
	if (!/^[A-Za-z0-9]{8,32}$/.test(id)) return;
	pendingReadIds.add(id);
	if (readFlushTimer) return;
	readFlushTimer = setTimeout(flushReadReceipts, 700)
}

function flushReadReceipts() {
	readFlushTimer = null;
	if (!readReceiptSender || pendingReadIds.size === 0) return;
	const ids = Array.from(pendingReadIds).slice(0, 50);
	for (const id of ids) pendingReadIds.delete(id);
	try {
		readReceiptSender(ids)
	} catch (_e) { /* receipt sending is best-effort */ }
}

// Reveal the ✓✓ chip on one of my own bubbles when a peer confirms reading it.
// 对端确认已读后，点亮自己气泡上的 ✓✓ 徽标。
export function markMessageReadDom(mid) {
	const id = String(mid || '');
	if (!/^[A-Za-z0-9]{8,32}$/.test(id)) return;
	const chip = document.querySelector('#chat-area [data-mid="' + id + '"] .msg-read');
	if (chip) chip.hidden = false
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
		addSystemMsg(t('search.not_loaded', 'This message is not in the current view (older than loaded history).'), true);
		return
	}
	el.scrollIntoView({ block: 'center', behavior: 'smooth' });
	addClass(el, 'search-hit');
	setTimeout(() => removeClass(el, 'search-hit'), 1500)
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
		bar = createElement('div', { id: 'jmlt-select-bar', class: 'jmlt-select-bar' }, [
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
		addSystemMsg(t('search.copy_failed', 'Clipboard unavailable'), true)
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
		addSystemMsg(t('search.forward_private_blocked', 'Private messages cannot be forwarded to other rooms.'), true);
		return
	}
	const targets = [];
	for (let i = 0; i < roomsData.length; i++) {
		const r = roomsData[i];
		if (i !== activeRoomIndex && r && r.chat && r.roomName) targets.push({ idx: i, name: r.roomName })
	}
	if (targets.length === 0) {
		addSystemMsg(t('search.no_other_rooms', 'Open another room first to forward messages.'), true);
		return
	}
	const modal = createElement('div', { class: 'file-upload-modal show' }, [
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
			addSystemMsg(note + extra, true)
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

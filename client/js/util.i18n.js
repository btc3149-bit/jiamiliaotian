// Simple i18n utility for NodeCrypt
// NodeCrypt 简单国际化工具

// Language definitions
// 语言定义
const LANGUAGES = {
	en: {
		code: 'en',
		name: 'English',
		flag: '🇺🇸',
		translations: {
			// Meta tags for SEO
			'meta.description': 'NodeCrypt - True end-to-end encrypted chat system, no database, all messages encrypted locally, server only relays encrypted data, supports Cloudflare Workers, Docker, self-hosting and local development.',
			'meta.keywords': 'end-to-end encryption, security, chat, WebSocket, Cloudflare Workers, JavaScript, E2EE, anonymous communication, AES, ECDH, RSA, ChaCha20, security, open source, NodeCrypt, shuaiplus',
			'meta.og_title': 'NodeCrypt - End-to-End Encrypted Chat System',
			'meta.og_description': 'NodeCrypt is a zero-knowledge, end-to-end encrypted open source chat system where all encryption and decryption is done locally on the client side, and servers cannot access plaintext. Supports multi-platform deployment, secure, anonymous, no message history.',
			'meta.twitter_title': 'NodeCrypt - End-to-End Encrypted Chat System',
			'meta.twitter_description': 'NodeCrypt is a zero-knowledge, end-to-end encrypted open source chat system where all encryption and decryption is done locally on the client side, and servers cannot access plaintext.',
			
			// Login and main UI
			'ui.enter_node': 'Enter a Room',
			'ui.username': 'Username',
			'ui.node_name': 'Room Name',
			'ui.node_password': 'Room Password',
			'ui.optional': '(optional)',
			'ui.enter': 'ENTER',
			'ui.connecting': 'Connecting...',
			'ui.node_exists': 'Room already exists',
			'ui.my_name': 'My Name',
			'ui.members': 'Members',
			'ui.message': 'Message',
			'ui.private_message_to': 'Private Message to',
			'ui.me': ' (me)',
			'ui.typing': 'is typing…',
			'ui.typing_more': ' and others',
			'ui.reply': 'Reply',
			'ui.edit': 'Edit',
			'ui.delete': 'Recall',
			'ui.recalled': 'Message recalled',
			'ui.burned': 'Message expired',
			'ui.edited': '(edited)',
			'ui.editing_msg': 'Editing message',
			'ui.cancel': 'Cancel',
			'ui.burn_off': 'Burn timer: off',
			'ui.confirm_recall': 'Recall this message?',
			'settings.appearance_privacy': 'Appearance & Privacy',
			'settings.dark_mode': 'Dark Mode',
			'settings.dark_auto': 'Follow System',
			'settings.dark_light': 'Light',
			'settings.dark_dark': 'Dark',
			'settings.local_history': 'Local Encrypted History',
			'settings.local_history_desc': 'Keep recent messages on this device, encrypted with the room password (AES-GCM). Nothing leaves your browser; cleared when you click the button below.',
			'settings.clear_history': 'Clear Local History',
			'settings.clear_history_desc': 'Delete all locally stored encrypted message history from this device.',
			'settings.clear_history_btn': 'Clear',
			'settings.send_original': 'Send Original Images',
			'settings.send_original_desc': 'By default images are re-drawn locally before sending: EXIF metadata (including GPS and device info) is stripped and large photos are compressed. Turn this on to send the untouched original file instead.',
			'settings.mute_room': 'Mute This Room (front-end only)',
			'settings.mute_room_desc': 'Silence desktop notifications and sounds for the currently open room on this device. Note: background Web Push wake-ups still occur (they never contain content).',
			'settings.panic_wipe': 'Panic Wipe',
			'settings.panic_wipe_desc': 'Immediately erase EVERYTHING this app stored on this device: room key pins, settings, drafts, encrypted history and caches. Requires double confirmation and cannot be undone.',
			'settings.panic_wipe_hotkey': 'Shortcut: Ctrl+Shift+Backspace.',
			'settings.panic_wipe_btn': 'Wipe Everything',
			'search.placeholder': 'Search in this room…',
			'search.hint': 'Type to search messages in this room',
			'search.no_results': 'No results',
			'search.not_loaded': 'This message is not in the current view (older than loaded history).',
			'search.selected_count': 'Selected: {n}',
			'search.copy': 'Copy',
			'search.copy_failed': 'Clipboard unavailable',
			'search.forward': 'Forward',
			'search.forward_to': 'Forward to…',
			'search.forward_private_blocked': 'Private messages cannot be forwarded to other rooms.',
			'search.forwarded': 'Forwarded {n} message(s) to #{room}',
			'search.no_other_rooms': 'Open another room first to forward messages.',
			'search.private_skipped': '{n} private message(s) skipped',
			'system.queued_offline': 'Offline — message queued and will be sent after reconnect.',
			'system.queue_flushed': 'Sent {n} queued message(s) after reconnect.',
			'system.voice_failed': 'Voice recording unavailable ({reason}).',
			'system.resume_requested': 'Missing {n} part(s) of "{name}" — requesting re-send.',
			'system.file_too_large_incoming': 'Refused "{name}": {size} exceeds this device\'s transfer limit ({limit}).',
			'file.too_large': 'Transfer too large — the limit is {limit} per send (everything stays in memory; the server stores nothing).',
			'file.waiting_resume': 'Waiting for re-send…',
			'notification.voice': '[voice]',
			'settings.current_room': 'Current Room',
			'settings.room_alias': 'Room Alias (local only)',
			'settings.room_alias_desc': 'Only changes the name YOU see. Room identity is password + hash — renaming never changes any security property.',
			'settings.room_group': 'Group Tag (local only)',
			'settings.room_group_desc': 'A small badge shown next to the room name in your list.',
			'settings.room_pin': 'Pin This Room',
			'settings.room_pin_desc': 'Pinned rooms float to the top of your list.',
			'settings.export_archive': 'Export Encrypted Archive',
			'settings.export_archive_desc': "Downloads a password-encrypted .jmlt file of this room's messages. Encrypted locally with the room password (AES-256-GCM). Anyone with the file AND the room password can read it — guard both.",
			'settings.export_archive_btn': 'Export',
			'settings.import_archive': 'Import Encrypted Archive',
			'settings.import_archive_desc': 'Merge a .jmlt archive into this room. It must have been exported from the SAME room (fingerprint is verified). Messages are deduplicated by id.',
			'settings.import_archive_btn': 'Choose File…',
			'settings.export_no_room': 'Join a room first.',
			'settings.export_ask_password': 'Room password (for encryption):',
			'settings.export_done': 'Archive exported ({n} messages, {s} file transfer(s) skipped). Guard the file — it is only as safe as where you keep it.',
			'settings.export_failed': 'Export failed: ',
			'settings.import_ask_password': 'Room password (to decrypt the archive):',
			'settings.import_done': 'Imported {n} message(s) ({d} duplicate(s) skipped).',
			'settings.import_failed': 'Import failed — wrong password, wrong room, or corrupted file.',
			'system.share_received': 'Shared content added to the composer — nothing was stored.',
			'system.history_cleared': 'Local message history cleared (encrypted blobs removed).',
			'action.share_title': 'Invite to Room',
			'action.share_qr_hint': 'Scan to join this room',
			'action.qr_failed': 'QR code unavailable — copy the link below.',
			'action.copy_link': 'Copy Link',
			'ui.anonymous': 'Anonymous',
			'ui.start_private_chat': 'Select for private chat',
			
			// Settings panel
			'settings.title': 'Settings',
			'settings.notification': 'Notification Settings',
			'settings.theme': 'Theme Settings',
			'settings.language': 'Language Settings',
			'settings.desktop_notifications': 'Desktop Notifications',
			'settings.sound_notifications': 'Sound Notifications',
			'settings.web_push': 'Offline Push (PWA installed)',
			'settings.web_push_desc': 'Wake this device when a new message arrives while the app is closed. The notification only ever says "you have a new message" — never the room, sender or content. Requires HTTPS.',
			'settings.web_push_unsupported': 'Web Push is not supported in this browser (or the app is not served over HTTPS).',
			'settings.web_push_denied': 'Notification permission was denied. Please allow notifications in your browser settings.',
			'settings.web_push_failed': 'Could not enable offline push. Please try again.',
			'settings.language_switch': 'Language',
			'settings.server_url': 'Server URL (desktop app)',
			'settings.server_url_desc': 'Only used by the bundled desktop app: the https:// address of your own deployment. Leave empty to use the server this page was loaded from.',
			'settings.server_url_apply': 'Apply Server URL',
			'settings.server_url_save': 'Save & Reload',
			'settings.server_url_invalid': 'Please enter a valid https:// URL (or leave empty to use the current server).',
			'settings.chinese': 'Chinese',
			'settings.english': 'English',
			
			// File upload and transfer
			'file.selected_files': 'Selected Files',
			'file.clear_all': 'Clear All',
			'file.cancel': 'Cancel',
			'file.send_files': 'Send Files',			'file.sending': 'Sending',
			'file.receiving': 'Receiving',
			'file.files': 'files',
			'file.total': 'Total',
			'file.files_selected': '{count} files selected, {size} total',
			'file.upload_files': 'Upload Files',
			'file.attach_file': 'Attach file',
			'file.no_password_required': 'No password required',
			'file.drag_drop': 'Drag and drop files here',
			'file.or': 'or',
			'file.browse_files': 'browse files',
			
			// Notifications and messages
			'notification.enabled': 'Notifications enabled',
			'notification.alert_here': 'You will receive alerts here.',
			'notification.not_supported': 'Notifications are not supported by your browser.',
			'notification.allow_browser': 'Please allow notifications in your browser settings.',
			'notification.image': '[image]',
			'notification.private': '(Private)',
			
			// Actions and menu
			'action.share': 'Share',
			'action.exit': 'Exit',
			'action.emoji': 'Emoji',
			'action.settings': 'Settings',
			'action.back': 'Back',
			'action.copied': 'Copied to clipboard!',
			'action.share_copied': 'Share link copied!',
			'action.copy_failed': 'Copy failed, text:',
			'action.copy_url_failed': 'Copy failed, url:',
			'action.nothing_to_copy': 'Nothing to copy',
			'action.copy_not_supported': 'Copy not supported in this environment',
			'action.action_failed': 'Action failed. Please try again.',
			'action.cannot_share': 'Cannot share:',
					// System messages
			'system.security_warning': '⚠️ This link uses an old format. Room data is not encrypted.',
			'system.file_send_failed': 'Failed to send files:',
			'system.joined': 'joined the conversation',
			'system.left': 'left the conversation',
			'system.secured': 'connection secured',
			'system.reconnecting': 'Connection lost — reconnecting. Messages sent while offline may be missing.',
			'system.sync_done': 'missed message(s) restored from peers',
			'system.private_message_failed': 'Cannot send private message to',
			'system.private_file_failed': 'Cannot send private file to',
			'system.user_not_connected': 'User might not be fully connected.',
					// Help page
			'help.title': 'User Guide',
			'help.back_to_login': 'Back to Login',
			'help.usage_guide': 'User Guide',
			'help.what_is_nodecrypt': '🔐 What is NodeCrypt?',			'help.what_is_nodecrypt_desc': 'NodeCrypt is a true zero-knowledge end-to-end encrypted chat system. With a database-free architecture, all messages are encrypted locally on your device, and the server serves only as an encrypted data relay station, unable to access any of your plaintext content.',
			'help.how_to_start': '🚀 Quick Start',
			'help.step_username': 'Enter Username',
			'help.step_username_desc': 'Choose a display name for the room, can be any name you like',
			'help.step_node_name': 'Set Room Name',
			'help.step_node_name_desc': 'Unique identifier for the room, equivalent to room number',
			'help.step_password': 'Set Room Password',
			'help.step_password_desc': 'Used to distinguish different rooms while participating in encryption process to enhance security',
			'help.step_join': 'Click "Join Room"',
			'help.step_join_desc': 'System will automatically generate encryption keys and start secure chatting',
			'help.security_features': '🔑 Security Features',			'help.e2e_encryption': '🛡️ End-to-End Encryption',
			'help.e2e_encryption_desc': 'Uses AES-256 + ECDH encryption algorithm, messages can only be decrypted by you and the recipient',
			'help.password_enhanced_encryption': '🔐 Password Enhanced Encryption',
			'help.password_enhanced_encryption_desc': 'Room password directly participates in encryption key generation, providing additional security protection layer',
			'help.no_history': '🚫 Zero History Records',
			'help.no_history_desc': 'All messages exist only in current session, offline users cannot get historical messages',
			'help.anonymous_communication': '🎭 Complete Anonymity',
			'help.anonymous_communication_desc': 'No account registration required, no personal information collected',
			'help.decentralized': '🌐 Decentralized',
			'help.decentralized_desc': 'Supports self-hosted deployment, server does not participate in encryption/decryption process',			'help.usage_tips': '💡 Usage Tips',
			'help.important_note': '⚠️ Important Note',
			'help.room_isolation_note': 'Same room name but different passwords are two completely independent rooms that cannot communicate with each other.',
			'help.tip_private_chat': 'Private Chat',
			'help.tip_private_chat_desc': 'Use complex room names and passwords, share only with specific people',
			'help.tip_group_chat': 'Group Chat',
			'help.tip_group_chat_desc': 'Use simple and memorable room names and passwords for easy multi-user joining',
			'help.tip_security_reminder': 'Security Reminder',
			'help.tip_security_reminder_desc': 'Both room name and password must be exactly the same to enter the same room',
			'help.tip_password_strategy': 'Password Strategy',
			'help.tip_password_strategy_desc': 'Recommend using strong passwords containing letters, numbers and symbols',
			// v1.4.0 #3: app lock
			'settings.applock': 'App Lock (WebAuthn)',
			'settings.applock_desc': 'Lock the screen with this device\'s platform authenticator (fingerprint / face / Windows Hello) after 5 minutes in the background, or lock manually below. The credential never leaves this device. Honest limits: this is an anti-shoulder-surfing guard — it does NOT resist a technical user (DevTools) or forensics.',
			'settings.applock_now': 'Lock Now',
			'settings.applock_now_desc': 'Immediately lock the screen (requires App Lock to be enabled).',
			'settings.applock_now_btn': 'Lock',
			'settings.applock_need_enable': 'Enable App Lock first.',
			'settings.applock_unsupported': 'App Lock requires a platform authenticator (fingerprint / face / Windows Hello). Not available in this browser.',
			'settings.applock_failed': 'Could not register the app lock credential.',
			'applock.title': 'Locked',
			'applock.hint': 'Unlock with your device authenticator (fingerprint / face / PIN)',
			'applock.unlock': 'Unlock',
			'applock.failed': 'Unlock failed — try again.',
			'applock.emergency': 'Locked out? Erase all local app data',
			'applock.emergency_confirm': 'This erases ALL local app data (pins, settings, history, caches) and disables App Lock. Continue?',
			// v1.4.0 #12: presence
			'settings.presence': 'Share My Status',
			'settings.presence_desc': 'Optionally broadcast a self-declared status (online / away / busy) to room members as an encrypted signal. OFF by default — when off, nothing is ever sent. Switching off stops future announcements; an already-shown status remains until you leave.',
			'presence.off': 'Do not share (default)',
			'presence.online': '🟢 Online',
			'presence.away': '🌙 Away',
			'presence.busy': '⛔ Busy',
			// v1.4.0 #14: credential migration
			'migration.title': 'Room Credentials — Migration',
			'migration.qr_hint': 'Scan with the other device (valid 10 minutes), or use the file / link below.',
			'migration.copy': 'Copy Link',
			'migration.download': 'Download File (.jmltk)',
			'migration.prefilled': 'Room credentials imported from migration link — review and press ENTER to join.',
			'settings.export_creds': 'Export Room Credentials (Migration)',
			'settings.export_creds_desc': 'Creates a QR code / file containing this room\'s name + password, encrypted with a one-time key you choose. Valid for 10 minutes. The server pin is NOT migrated — the new device re-establishes trust on first connect (by design, so trust is never copied).',
			'settings.export_creds_btn': 'Export…',
			'settings.export_creds_key': 'Choose a one-time migration key (to encrypt the credentials):',
			'settings.export_creds_done': 'Credentials exported — scan the QR on the new device within 10 minutes.',
			'settings.import_creds': 'Import Room Credentials',
			'settings.import_creds_desc': 'Open a .jmltk migration file (or scan the QR on the login screen). You need the one-time key that was used to create it. Files expire after 10 minutes.',
			'settings.import_creds_btn': 'Choose File…',
			'settings.import_creds_key': 'Migration key (to decrypt the credentials):',
			'settings.import_creds_done': 'Room credentials imported — review and press ENTER to join.',
			'settings.import_creds_failed': 'Import failed — wrong key or corrupted file.',
			'settings.import_creds_expired': 'Import failed — the migration expired (valid for 10 minutes). Export again.',
			// v1.5.0 #16: P2P calls
			'settings.p2p_calls': 'Allow P2P Calls (peer sees your IP)',
			'settings.p2p_calls_desc': 'Enable 1-to-1 audio/video calls with your private-chat partner. Media is peer-to-peer (DTLS-SRTP enforced by the browser), which means the other party can see your IP address — that is the nature of direct connections. OFF by default; no call signal is ever sent or accepted while off. Signaling itself always stays inside the end-to-end encrypted channel.',
			'settings.stun_servers': 'STUN Servers (optional)',
			'settings.stun_servers_desc': 'Only needed across different networks. Comma-separated stun:host[:port] entries, at most 4. Nothing is built in — you choose your own servers (they can see connection attempts, not content). Empty = LAN/same-network only.',
			'call.disabled': 'P2P calls are disabled. Enable them in Settings (the peer will see your IP — that is the nature of direct connections).',
			'call.busy': 'A call is already in progress.',
			'call.need_private': 'Select a private-chat partner first — calls are 1-to-1.',
			'call.calling': 'Calling {name}…',
			'call.ringing': 'Ringing…',
			'call.connecting': 'Connecting…',
			'call.active': 'In call',
			'call.incoming': 'Incoming call…',
			'call.incoming_sys': '📞 Incoming call from {name}.',
			'call.no_answer': 'No answer (30 s).',
			'call.cancelled': 'Call cancelled by the peer.',
			'call.cancelled_by_you': 'Call cancelled.',
			'call.declined_by_peer': 'Call declined by {name}.',
			'call.declined_by_you': 'You declined the call.',
			'call.missed': 'Missed call from {name}.',
			'call.missed_busy': 'Missed call from {name} (busy).',
			'call.ended': 'Call ended.',
			'call.ended_duration': 'Call ended · {d}.',
			'call.failed': 'Call failed — the network cannot establish a direct connection (no TURN server; P2P reachability is best-effort).',
			'call.media_failed': 'Could not access microphone/camera — call cancelled.',
			'call.signal_failed': 'Could not deliver the call signal — is the peer still connected?'
		}
	},
	zh: {
		code: 'zh',
		name: '中文',
		flag: '🇨🇳',
		translations: {
			// Meta tags for SEO
			'meta.description': 'NodeCrypt - 真正的端到端加密聊天系统，无数据库，所有消息本地加密，服务器仅做加密数据中转，支持 Cloudflare Workers、Docker、自托管和本地开发。',
			'meta.keywords': '端到端加密, 安全, 聊天, WebSocket, Cloudflare Workers, JavaScript, E2EE, 匿名通信, AES, ECDH, RSA, ChaCha20, 安全, 开源, NodeCrypt, shuaiplus',
			'meta.og_title': 'NodeCrypt - 端到端加密聊天系统',
			'meta.og_description': 'NodeCrypt 是一个端到端加密的开源聊天系统，所有加密解密均在客户端本地完成，服务器无法获取明文。支持多平台部署，安全、匿名、无历史消息。',
			'meta.twitter_title': 'NodeCrypt - 端到端加密聊天系统',
			'meta.twitter_description': 'NodeCrypt 是一个端到端加密的开源聊天系统，所有加密解密均在客户端本地完成，服务器无法获取明文。',
			
			// Login and main UI
			'ui.enter_node': '进入新的房间',
			'ui.username': '用户名',
			'ui.node_name': '房间名称',
			'ui.node_password': '房间密码',
			'ui.optional': '（可选）',
			'ui.enter': '确定',
			'ui.connecting': '连接中...',
			'ui.node_exists': '此房间已存在',
			'ui.my_name': '我的名字',
			'ui.members': '在线成员',
			'ui.message': '消息',
			'ui.private_message_to': '私信给',
			'ui.me': '（我）',
			'ui.typing': '正在输入…',
			'ui.typing_more': ' 等人',
			'ui.reply': '回复',
			'ui.edit': '编辑',
			'ui.delete': '撤回',
			'ui.recalled': '消息已撤回',
			'ui.burned': '消息已焚毁',
			'ui.edited': '（已编辑）',
			'ui.editing_msg': '正在编辑消息',
			'ui.cancel': '取消',
			'ui.burn_off': '阅后即焚：关',
			'ui.confirm_recall': '确定撤回这条消息吗？',
			'settings.appearance_privacy': '外观与隐私',
			'settings.dark_mode': '深色模式',
			'settings.dark_auto': '跟随系统',
			'settings.dark_light': '浅色',
			'settings.dark_dark': '深色',
			'settings.local_history': '本地加密消息历史',
			'settings.local_history_desc': '将最近消息以房间密码加密（AES-GCM）保存在本设备上。数据不离开浏览器，点击下方按钮即可清除。',
			'settings.clear_history': '清除本地历史',
			'settings.clear_history_desc': '删除本设备上所有已存储的加密消息历史。',
			'settings.clear_history_btn': '清除',
			'settings.send_original': '发送原图',
			'settings.send_original_desc': '默认发送前会在本地重绘图片：剥离 EXIF 元数据（含 GPS 定位、设备信息），并压缩大图。开启后改为发送未经处理的原始文件。',
			'settings.mute_room': '当前房间免打扰（仅前台）',
			'settings.mute_room_desc': '在本设备上静音当前打开房间的桌面通知和提示音。注意：后台 Web Push 唤醒仍会发生（其内容不含任何消息信息）。',
			'settings.panic_wipe': '恐慌清除',
			'settings.panic_wipe_desc': '立即抹除本应用在本设备上存储的全部数据：房间密钥 pin、设置、草稿、加密历史和缓存。需双重确认，不可撤销。',
			'settings.panic_wipe_hotkey': '快捷键：Ctrl+Shift+Backspace。',
			'settings.panic_wipe_btn': '全部抹除',
			'search.placeholder': '在本房间内搜索…',
			'search.hint': '输入关键词搜索本房间消息',
			'search.no_results': '无结果',
			'search.not_loaded': '该消息不在当前已加载的历史范围内。',
			'search.selected_count': '已选 {n} 条',
			'search.copy': '复制',
			'search.copy_failed': '剪贴板不可用',
			'search.forward': '转发',
			'search.forward_to': '转发到…',
			'search.forward_private_blocked': '私聊消息不能跨房间转发。',
			'search.forwarded': '已向 #{room} 转发 {n} 条消息',
			'search.no_other_rooms': '请先打开另一个房间再转发。',
			'search.private_skipped': '{n} 条私聊消息已跳过',
			'system.queued_offline': '当前离线——消息已排队，重连后自动发送。',
			'system.queue_flushed': '重连后已发送 {n} 条排队消息。',
			'system.voice_failed': '无法录音（{reason}）。',
			'system.resume_requested': '“{name}”缺失 {n} 个分片——已请求补发。',
			'system.file_too_large_incoming': '已拒收「{name}」：{size} 超出本机传输上限（{limit}）。',
			'file.too_large': '传输体积超限——单次发送上限 {limit}（全部驻留内存，服务器不存储任何内容）。',
			'file.waiting_resume': '等待补发…',
			'notification.voice': '[语音]',
			'settings.current_room': '当前房间',
			'settings.room_alias': '房间别名（仅本地）',
			'settings.room_alias_desc': '只改变你自己看到的名称。房间身份 = 密码 + 哈希——改名不改变任何安全属性。',
			'settings.room_group': '分组标签（仅本地）',
			'settings.room_group_desc': '在房间列表名称旁显示的小徽标。',
			'settings.room_pin': '置顶本房间',
			'settings.room_pin_desc': '置顶的房间会排在列表最上方。',
			'settings.export_archive': '导出加密存档',
			'settings.export_archive_desc': '把本房间消息导出为密码加密的 .jmlt 文件（本地 AES-256-GCM，密钥来自房间密码）。持有文件 + 房间密码的人即可解密——两者都要保管好。',
			'settings.export_archive_btn': '导出',
			'settings.import_archive': '导入加密存档',
			'settings.import_archive_desc': '把 .jmlt 存档合并进本房间。必须导出自同一房间（会校验指纹），消息按 id 自动去重。',
			'settings.import_archive_btn': '选择文件…',
			'settings.export_no_room': '请先加入一个房间。',
			'settings.export_ask_password': '房间密码（用于加密）：',
			'settings.export_done': '存档已导出（{n} 条消息，{s} 个文件传输跳过）。请妥善保管文件——它的安全性取决于你把它放在哪。',
			'settings.export_failed': '导出失败：',
			'settings.import_ask_password': '房间密码（用于解密存档）：',
			'settings.import_done': '已导入 {n} 条消息（跳过 {d} 条重复）。',
			'settings.import_failed': '导入失败——密码错误、房间不匹配或文件已损坏。',
			'system.share_received': '分享内容已填入输入框——未做任何存储。',
			'system.history_cleared': '已清除本地消息历史（密文已删除）。',
			'action.share_title': '邀请加入房间',
			'action.share_qr_hint': '扫码加入本房间',
			'action.qr_failed': '二维码生成失败，请复制下方链接。',
			'action.copy_link': '复制链接',
			'ui.anonymous': '匿名用户',
			'ui.start_private_chat': '选择用户开始私信',
			
			// Settings panel
			'settings.title': '设置',
			'settings.notification': '通知设置',
			'settings.theme': '主题设置',
			'settings.language': '语言设置',
			'settings.desktop_notifications': '桌面通知',
			'settings.sound_notifications': '声音通知',
			'settings.web_push': '离线推送（需安装 PWA）',
			'settings.web_push_desc': '应用关闭期间有新消息时唤醒本设备。通知永远只显示「你有新消息」——不包含房间、发送者或任何内容。需要 HTTPS。',
			'settings.web_push_unsupported': '当前浏览器不支持 Web Push（或应用未通过 HTTPS 提供）。',
			'settings.web_push_denied': '通知权限被拒绝，请在浏览器设置中允许通知。',
			'settings.web_push_failed': '离线推送开启失败，请重试。',
			'settings.language_switch': '语言',
			'settings.server_url': '服务器地址（桌面应用）',
			'settings.server_url_desc': '仅桌面应用使用：填写你自己部署的 https:// 地址。留空则使用页面当前所在的服务器。',
			'settings.server_url_apply': '应用服务器地址',
			'settings.server_url_save': '保存并刷新',
			'settings.server_url_invalid': '请输入合法的 https:// 地址（或留空使用当前服务器）。',
			'settings.chinese': '中文',
			'settings.english': 'English',
			
			// File upload and transfer
			'file.selected_files': '已选择的文件',
			'file.clear_all': '清空所有',
			'file.cancel': '取消',
			'file.send_files': '发送文件',			'file.sending': '发送中',
			'file.receiving': '接收中',
			'file.files': '个文件',
			'file.total': '总计',
			'file.files_selected': '选中 {count} 个文件，总计 {size}',
			'file.upload_files': '上传文件',
			'file.attach_file': '附加文件',
			'file.no_password_required': '无需密码',
			'file.drag_drop': '拖拽文件到此处',
			'file.or': '或',
			'file.browse_files': '浏览文件',
			
			// Notifications and messages
			'notification.enabled': '通知已启用',
			'notification.alert_here': '您将在此处收到通知。',
			'notification.not_supported': '您的浏览器不支持通知功能。',
			'notification.allow_browser': '请在浏览器设置中允许通知。',
			'notification.image': '[图片]',
			'notification.private': '（私信）',
			
			// Actions and menu
			'action.share': '分享',
			'action.exit': '退出',
			'action.emoji': '表情',
			'action.settings': '设置',
			'action.back': '返回',
			'action.copied': '已复制到剪贴板！',
			'action.share_copied': '分享链接已复制！',
			'action.copy_failed': '复制失败，文本：',
			'action.copy_url_failed': '复制失败，链接：',
			'action.nothing_to_copy': '没有内容可复制',
			'action.copy_not_supported': '此环境不支持复制功能',
			'action.action_failed': '操作失败，请重试。',
			'action.cannot_share': '无法分享：',
					// System messages
			'system.security_warning': '⚠️ 此链接使用旧格式，房间数据未加密。',
			'system.file_send_failed': '文件发送失败：',
			'system.joined': '加入了对话',
			'system.left': '离开了对话',
			'system.secured': '已建立端到端安全连接',
			'system.reconnecting': '连接已断开，正在重连。离线期间发送的消息可能缺失。',
			'system.sync_done': '条离线期间的消息已从同伴补回',
			'system.private_message_failed': '无法发送私信给',
			'system.private_file_failed': '无法发送私密文件给',
			'system.user_not_connected': '用户可能未完全连接。',
			
			// Help page
			'help.title': '使用说明',
			'help.back_to_login': '返回登录',
			'help.usage_guide': '使用说明',
			'help.what_is_nodecrypt': '🔐 什么是 NodeCrypt？',			'help.what_is_nodecrypt_desc': 'NodeCrypt 是一个真正的端到端加密聊天系统。采用无数据库架构，所有消息在您的设备上本地加密，服务器仅作为加密数据的中转站，无法获取您的任何明文内容。',
			'help.how_to_start': '🚀 快速开始',
			'help.step_username': '输入用户名',
			'help.step_username_desc': '选择一个在房间中显示的昵称，可以是任何您喜欢的名称',
			'help.step_node_name': '设置房间名',
			'help.step_node_name_desc': '房间的唯一标识符，相当于房间号',
			'help.step_password': '设置房间密码',
			'help.step_password_desc': '用于区分不同房间，同时参与加密过程，提升安全性',
			'help.step_join': '点击"加入房间"',
			'help.step_join_desc': '系统将自动生成加密密钥，开始安全聊天',
			'help.security_features': '🔑 安全特性',
			'help.e2e_encryption': '🛡️ 端到端加密',
			'help.e2e_encryption_desc': '使用 AES-256 + ECDH 加密算法，消息仅您和接收者可解密',
			'help.password_enhanced_encryption': '🔐 密码增强加密',
			'help.password_enhanced_encryption_desc': '房间密码直接参与加密密钥生成，提供额外的安全保护层',
			'help.no_history': '🚫 零历史记录',
			'help.no_history_desc': '所有消息仅存在于当前会话，离线用户无法获取历史消息',
			'help.anonymous_communication': '🎭 完全匿名',
			'help.anonymous_communication_desc': '无需注册账户，不收集任何个人信息',
			'help.decentralized': '🌐 去中心化',
			'help.decentralized_desc': '支持自托管部署，服务器不参与加密解密过程',			'help.usage_tips': '💡 使用技巧',
			'help.important_note': '⚠️ 重要提示',
			'help.room_isolation_note': '相同房间名但不同密码的是两个完全独立的房间，无法相互通信。',
			'help.tip_private_chat': '私人对话',
			'help.tip_private_chat_desc': '使用复杂的房间名和密码，只分享给特定人员',
			'help.tip_group_chat': '群聊',
			'help.tip_group_chat_desc': '使用简单易记的房间名和密码，方便多人加入',
			'help.tip_security_reminder': '安全提醒',
			'help.tip_security_reminder_desc': '房间名和密码都需要完全一致才能进入同一个房间',
			'help.tip_password_strategy': '密码策略',
			'help.tip_password_strategy_desc': '建议使用包含字母、数字和符号的强密码',
			// v1.4.0 #3: 应用锁
			'settings.applock': '应用锁（WebAuthn）',
			'settings.applock_desc': '用本设备的平台验证器（指纹 / 面容 / Windows Hello）锁定界面：切后台超过 5 分钟自动锁定，也可手动锁定。凭据只存本机、绝不上传。诚实边界：这是防顺手看的锁——不防技术用户（DevTools）、不防取证。',
			'settings.applock_now': '立即锁定',
			'settings.applock_now_desc': '马上锁定屏幕（需先开启应用锁）。',
			'settings.applock_now_btn': '锁定',
			'settings.applock_need_enable': '请先开启应用锁。',
			'settings.applock_unsupported': '应用锁需要平台验证器（指纹 / 面容 / Windows Hello），当前浏览器不可用。',
			'settings.applock_failed': '应用锁凭据注册失败。',
			'applock.title': '已锁定',
			'applock.hint': '使用本设备验证器解锁（指纹 / 面容 / PIN）',
			'applock.unlock': '解锁',
			'applock.failed': '解锁失败——请重试。',
			'applock.emergency': '被锁在外面了？抹除全部本地数据',
			'applock.emergency_confirm': '将抹除本应用全部本地数据（pin、设置、历史、缓存）并关闭应用锁。继续吗？',
			// v1.4.0 #12: 在线状态
			'settings.presence': '共享我的状态',
			'settings.presence_desc': '可选择向房间成员以加密信号广播自声明状态（在线 / 离开 / 忙碌）。默认关闭——关闭时什么都不发送。关闭后停止后续广播；已显示的状态保持到你离开房间为止。',
			'presence.off': '不共享（默认）',
			'presence.online': '🟢 在线',
			'presence.away': '🌙 离开',
			'presence.busy': '⛔ 忙碌',
			// v1.4.0 #14: 凭据迁移
			'migration.title': '房间凭据——迁移',
			'migration.qr_hint': '用另一台设备扫码（10 分钟内有效），或使用下方文件 / 链接。',
			'migration.copy': '复制链接',
			'migration.download': '下载文件（.jmltk）',
			'migration.prefilled': '已从迁移链接导入房间凭据——确认无误后按「进入」加入。',
			'settings.export_creds': '导出房间凭据（迁移）',
			'settings.export_creds_desc': '生成包含本房间「房间名 + 密码」的二维码 / 文件，用你设定的一次性密钥加密。10 分钟内有效。服务器 pin 不随迁移——新设备首连时重新建立信任（刻意设计，杜绝「信任被复制」）。',
			'settings.export_creds_btn': '导出…',
			'settings.export_creds_key': '设定一次性迁移密钥（用于加密凭据）：',
			'settings.export_creds_done': '凭据已导出——请在 10 分钟内于新设备扫码。',
			'settings.import_creds': '导入房间凭据',
			'settings.import_creds_desc': '打开 .jmltk 迁移文件（或在登录页扫二维码）。需要创建时设定的一次性密钥。文件 10 分钟后过期。',
			'settings.import_creds_btn': '选择文件…',
			'settings.import_creds_key': '迁移密钥（用于解密凭据）：',
			'settings.import_creds_done': '房间凭据已导入——确认无误后按「进入」加入。',
			'settings.import_creds_failed': '导入失败——密钥错误或文件损坏。',
			'settings.import_creds_expired': '导入失败——迁移已过期（有效期 10 分钟），请重新导出。',
			// v1.5.0 #16: P2P 通话
			'settings.p2p_calls': '允许 P2P 通话（对方可见你的 IP）',
			'settings.p2p_calls_desc': '开启后可与私聊对象进行一对一音视频通话。媒体走点对点直连（浏览器强制 DTLS-SRTP 加密），意味着对方能看到你的 IP 地址——这是直连的本质。默认关闭；关闭时不发送也不接受任何通话信令。信令本身始终走端到端加密通道。',
			'settings.stun_servers': 'STUN 服务器（可选）',
			'settings.stun_servers_desc': '仅跨不同网络时需要。逗号分隔的 stun:host[:port]，最多 4 个。不内置任何服务器——用你自己选的（它们能看到连接尝试，看不到内容）。留空 = 仅局域网/同网。',
			'call.disabled': 'P2P 通话未开启。请在设置中开启（对方将看到你的 IP——直连的本质）。',
			'call.busy': '已有通话进行中。',
			'call.need_private': '请先选择私聊对象——通话仅限一对一。',
			'call.calling': '正在呼叫 {name}…',
			'call.ringing': '响铃中…',
			'call.connecting': '连接中…',
			'call.active': '通话中',
			'call.incoming': '来电…',
			'call.incoming_sys': '📞 {name} 来电。',
			'call.no_answer': '无人接听（30 秒）。',
			'call.cancelled': '对方取消了通话。',
			'call.cancelled_by_you': '已取消通话。',
			'call.declined_by_peer': '{name} 拒绝了通话。',
			'call.declined_by_you': '已拒绝通话。',
			'call.missed': '未接来电：{name}。',
			'call.missed_busy': '未接来电：{name}（忙线）。',
			'call.ended': '通话已结束。',
			'call.ended_duration': '通话结束 · {d}。',
			'call.failed': '通话失败——当前网络无法直连（无 TURN 服务器；P2P 可达率非保证）。',
			'call.media_failed': '无法访问麦克风/摄像头——通话已取消。',
			'call.signal_failed': '通话信令发送失败——对方可能已断线。'
		}
	}
};

// Current language
// 当前语言
let currentLanguage = 'en';

// Get translation for a key
// 获取翻译文本
export function t(key, fallback = key) {
	const lang = LANGUAGES[currentLanguage];
	if (lang && lang.translations && lang.translations[key]) {
		return lang.translations[key];
	}
	return fallback;
}

// Set current language
// 设置当前语言
export function setLanguage(langCode) {
	if (LANGUAGES[langCode]) {
		currentLanguage = langCode;
		// Update document language attribute
		// 更新文档语言属性
		document.documentElement.lang = langCode;
		
		// Update static HTML texts
		// 更新HTML中的静态文本
		updateStaticTexts();
		
		// Dispatch language change event for other components to listen
		// 派发语言变更事件供其他组件监听
		window.dispatchEvent(new CustomEvent('languageChange', { 
			detail: { language: langCode } 
		}));
	}
}

// Get current language
// 获取当前语言
export function getCurrentLanguage() {
	return currentLanguage;
}

// Get all available languages
// 获取所有可用语言
export function getAvailableLanguages() {
	return Object.keys(LANGUAGES).map(code => ({
		code,
		name: LANGUAGES[code].name,
		flag: LANGUAGES[code].flag
	}));
}

// Initialize i18n with settings
// 根据设置初始化国际化
export function initI18n(settings) {
	if (settings && settings.language) {
		setLanguage(settings.language);
	} else {
		// Auto-detect browser language
		// 自动检测浏览器语言
		const browserLang = detectBrowserLanguage();
		setLanguage(browserLang);
	}
}

// Detect browser language and return supported language code
// 检测浏览器语言并返回支持的语言代码
function detectBrowserLanguage() {
	const navigatorLang = navigator.language || navigator.userLanguage || 'en';
	
	// Extract language code (e.g., 'zh-CN' -> 'zh', 'en-US' -> 'en')
	const langCode = navigatorLang.split('-')[0].toLowerCase();
	
	// Check if we support this language
	if (LANGUAGES[langCode]) {
		return langCode;
	}
	
	// Default fallback to English
	return 'en';
}

// Update static HTML text elements
// 更新HTML中的静态文本元素
export function updateStaticTexts() {
	// 如果DOM还没准备好，等待DOM准备好再更新
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => updateStaticTexts());
		return;
	}
	
	// Update login title
	const loginTitle = document.getElementById('login-title');
	if (loginTitle) {
		loginTitle.textContent = t('ui.enter_node', 'Enter a Room');
	}
		// Update login form content with new translations
	const loginFormContainer = document.getElementById('login-form');
	if (loginFormContainer) {
		// Use a custom event to trigger form regeneration instead of dynamic import
		// 使用自定义事件触发表单重新生成，而不是动态导入
		window.dispatchEvent(new CustomEvent('regenerateLoginForm'));
	}
	
	// Update sidebar username label
	const sidebarUsername = document.getElementById('sidebar-username');
	if (sidebarUsername) {
		// Use a custom event to update sidebar username instead of dynamic import
		// 使用自定义事件更新侧边栏用户名，而不是动态导入
		window.dispatchEvent(new CustomEvent('updateSidebarUsername'));
	}
	// Update "Enter a Room" text in sidebar
	const joinRoomText = document.getElementById('join-room-text');
	if (joinRoomText) {
		joinRoomText.textContent = t('ui.enter_node', 'Enter a Room');
	}
	
	// Update Members title in rightbar
	const membersTitle = document.getElementById('members-title');
	if (membersTitle) {
		membersTitle.textContent = t('ui.members', 'Members');
	}
	
	// Update settings title
	const settingsTitle = document.getElementById('settings-title');
	if (settingsTitle) {
		settingsTitle.textContent = t('settings.title', 'Settings');
	}
	
	// Update message placeholder
	const messagePlaceholder = document.querySelector('.input-field-placeholder');
	if (messagePlaceholder) {
		messagePlaceholder.textContent = t('ui.message', 'Message');
	}
	
	// Update attach button title
	const attachBtn = document.querySelector('.chat-attach-btn');
	if (attachBtn) {
		attachBtn.title = t('file.attach_file', 'Attach file');
	}
	
	// Update emoji button title
	const emojiBtn = document.querySelector('.chat-emoji-btn');
	if (emojiBtn) {
		emojiBtn.title = t('action.emoji', 'Emoji');
	}
		// Update settings button title
	const settingsBtn = document.getElementById('settings-btn');
	if (settingsBtn) {
		settingsBtn.title = t('action.settings', 'Settings');
		settingsBtn.setAttribute('aria-label', t('action.settings', 'Settings'));
	}
		// Update back button title
	const backBtn = document.getElementById('settings-back-btn');
	if (backBtn) {
		backBtn.title = t('action.back', 'Back');
		backBtn.setAttribute('aria-label', t('action.back', 'Back'));
	}
	
	// Update all elements with data-i18n attribute
	// 更新所有具有data-i18n属性的元素
	const i18nElements = document.querySelectorAll('[data-i18n]');
	i18nElements.forEach(element => {
		const key = element.getAttribute('data-i18n');
		if (key) {
			element.textContent = t(key, element.textContent || key);
		}
	});
	
	// Update all elements with data-i18n-title attribute
	// 更新所有具有data-i18n-title属性的元素
	const i18nTitleElements = document.querySelectorAll('[data-i18n-title]');
	i18nTitleElements.forEach(element => {
		const key = element.getAttribute('data-i18n-title');
		if (key) {
			element.title = t(key, element.title || key);
		}
	});
	
	// Update meta tags
	// 更新meta标签
	updateMetaTags();
}

// Update meta tags with current language
// 使用当前语言更新meta标签
function updateMetaTags() {
	// Update description meta tag
	const metaDescription = document.querySelector('meta[name="description"]');
	if (metaDescription) {
		metaDescription.content = t('meta.description', metaDescription.content);
	}
	
	// Update keywords meta tag
	const metaKeywords = document.querySelector('meta[name="keywords"]');
	if (metaKeywords) {
		metaKeywords.content = t('meta.keywords', metaKeywords.content);
	}
	
	// Update og:title meta tag
	const metaOgTitle = document.querySelector('meta[property="og:title"]');
	if (metaOgTitle) {
		metaOgTitle.content = t('meta.og_title', metaOgTitle.content);
	}
	
	// Update og:description meta tag
	const metaOgDescription = document.querySelector('meta[property="og:description"]');
	if (metaOgDescription) {
		metaOgDescription.content = t('meta.og_description', metaOgDescription.content);
	}
	
	// Update twitter:title meta tag
	const metaTwitterTitle = document.querySelector('meta[name="twitter:title"]');
	if (metaTwitterTitle) {
		metaTwitterTitle.content = t('meta.twitter_title', metaTwitterTitle.content);
	}
	
	// Update twitter:description meta tag
	const metaTwitterDescription = document.querySelector('meta[name="twitter:description"]');
	if (metaTwitterDescription) {
		metaTwitterDescription.content = t('meta.twitter_description', metaTwitterDescription.content);
	}
}

// Local encrypted message history (opt-in)
// 本地加密消息历史（可选功能）
//
// SECURITY / RULES.md 对照（第一准则逐条自查）：
// - 不变量 4（零持久化）：服务器侧零改动；客户端只在用户显式开启后，
//   把「自己可见的消息文本」加密存入 localStorage。密码/密钥素材绝不落盘——
//   解密密钥由房间密码经 PBKDF2(200k) 现场派生，仅存内存，刷新页面即消失。
// - 落盘内容永远是 AES-256-GCM 密文：拿到设备的人没有房间密码就读不出任何消息。
// - salt = 'jmlt_hist:' + 频道哈希（客户端自算），房间名明文不上存储。
// - 容量护栏：序列化超过 ~400KB 时从最旧的消息开始裁剪，防止撑爆配额。

const enc = new TextEncoder();
const dec = new TextDecoder();

function histStorageKey(channelHash) {
	const safe = String(channelHash || '');
	return /^[0-9a-f]{64}$/.test(safe) ? 'jmlt_hist:' + safe : null
}

function histSalt(channelHash) {
	return enc.encode('jmlt_hist:' + String(channelHash || ''))
}

export function isLocalHistoryEnabled() {
	try {
		const settings = JSON.parse(localStorage.getItem('settings') || '{}');
		return settings.localHistory === true
	} catch (error) {
		return false
	}
}

// Derive the AES-GCM history key from the room password (memory-only).
// 由房间密码派生历史加密密钥（仅存内存，绝不持久化）。
export async function deriveHistoryKey(password, channelHash) {
	const baseKey = await crypto.subtle.importKey(
		'raw', enc.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({
		name: 'PBKDF2',
		salt: histSalt(channelHash),
		iterations: 200000,
		hash: 'SHA-256'
	}, baseKey, 256);
	return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function computeChannelHash(roomName) {
	const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(roomName || '')));
	return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ---- save ------------------------------------------------------------------

const flushTimers = new WeakMap();

// Append one message entry to a room's encrypted local history.
// Entries live in an in-memory buffer (rd.historyBuffer) and are flushed
// (encrypted) on a short debounce — one ciphertext write per burst.
// 追加一条消息到房间的加密本地历史；防抖合并写盘。
export function appendLocalHistory(rd, entry) {
	if (!rd || !rd.historyKey || !rd.historyBuffer) return;
	if (!isLocalHistoryEnabled()) return;
	try {
		// Slim oversized entries (e.g. image dataURLs) instead of letting them
		// blow the quota — keep a tombstone so history ordering stays honest.
		// 超大条目（如图片 dataURL）瘦身为占位标记，防止撑爆配额。
		let safeEntry = entry;
		try {
			if (JSON.stringify(entry).length > 100 * 1024) {
				safeEntry = {
					type: 'system',
					text: '[oversized content omitted]',
					msgType: entry && entry.msgType || null,
					timestamp: entry && entry.timestamp || Date.now(),
					omitted: true
				}
			}
		} catch (error) {
			safeEntry = null
		}
		if (safeEntry) rd.historyBuffer.push(safeEntry);
		if (rd.historyBuffer.length > 300) {
			rd.historyBuffer = rd.historyBuffer.slice(-300)
		}
		const prev = flushTimers.get(rd);
		if (prev) clearTimeout(prev);
		flushTimers.set(rd, setTimeout(() => flushHistory(rd), 800))
	} catch (error) { /* best-effort */ }
}

async function flushHistory(rd) {
	if (!rd || !rd.historyKey || !rd.historyBuffer) return;
	const key = histStorageKey(rd.channelHash);
	if (!key) return;
	try {
		// Trim from the oldest until the payload is a sane size.
		// 序列化超限则从最旧开始裁剪。
		let payload = JSON.stringify(rd.historyBuffer);
		while (payload.length > 400 * 1024 && rd.historyBuffer.length > 1) {
			rd.historyBuffer = rd.historyBuffer.slice(Math.ceil(rd.historyBuffer.length / 2));
			payload = JSON.stringify(rd.historyBuffer)
		}
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ct = await crypto.subtle.encrypt({
			name: 'AES-GCM',
			iv
		}, rd.historyKey, enc.encode(payload));
		const blob = {
			v: 1,
			iv: Array.from(iv),
			ct: Array.from(new Uint8Array(ct))
		};
		localStorage.setItem(key, JSON.stringify(blob))
	} catch (error) {
		// QuotaExceeded etc. — history is best-effort, never break the chat.
		try {
			localStorage.removeItem(key)
		} catch (e) { /* noop */ }
	}
}

// ---- load ------------------------------------------------------------------

// Decrypt and return the stored history entries for a room (oldest first),
// or [] if none exists / decryption fails (e.g. wrong room password — which
// is exactly the correct behavior: wrong key reads nothing).
// 解密并返回房间本地历史（旧→新）；无数据或密码错误一律返回空数组——
// 密钥错了什么都读不出来，这正是该有的行为。
export async function loadLocalHistory(roomName, password, channelHash) {
	const key = histStorageKey(channelHash);
	if (!key || !isLocalHistoryEnabled()) return [];
	let blob;
	try {
		blob = JSON.parse(localStorage.getItem(key) || 'null')
	} catch (error) {
		return []
	}
	if (!blob || blob.v !== 1 || !Array.isArray(blob.iv) || !Array.isArray(blob.ct)) return [];
	try {
		const histKey = await deriveHistoryKey(password, channelHash);
		const plain = await crypto.subtle.decrypt({
			name: 'AES-GCM',
			iv: new Uint8Array(blob.iv)
		}, histKey, new Uint8Array(blob.ct));
		const entries = JSON.parse(dec.decode(plain));
		return Array.isArray(entries) ? entries : []
	} catch (error) {
		return [] // wrong password or tampered data — read nothing
	}
}

// ---- clear -----------------------------------------------------------------

// One-click clear: wipe every room's local history blob.
// Dispatches 'localHistoryCleared' so room modules can reset their in-memory
// buffers too (otherwise a later debounced flush would resurrect the data).
// 一键清除：删掉所有房间的本地历史密文，并广播事件让内存缓冲同步清空。
export function clearAllLocalHistory() {
	let removed = 0;
	try {
		const keys = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.indexOf('jmlt_hist:') === 0) keys.push(k)
		}
		keys.forEach(k => {
			localStorage.removeItem(k);
			removed++
		})
	} catch (error) { /* noop */ }
	try {
		window.dispatchEvent(new CustomEvent('localHistoryCleared'))
	} catch (error) { /* noop */ }
	return removed
}

// Attach the (memory-only) history key + buffer to a room data object.
// Call once per room join after the channel hash is known.
// 加入房间时挂载历史密钥（仅内存）与缓冲区。
export async function setupRoomHistory(rd, roomName, password) {
	rd.historyBuffer = [];
	rd.historyKey = null;
	rd.channelHash = null;
	if (!isLocalHistoryEnabled()) return null;
	const channelHash = await computeChannelHash(roomName);
	rd.channelHash = channelHash;
	rd.historyKey = await deriveHistoryKey(password, channelHash);
	return channelHash
}

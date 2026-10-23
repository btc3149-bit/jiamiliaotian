// v1.3.0 #7: encrypted chat archive export/import (.jmlt).
// SECURITY / RULES.md 对照：
// - 不变量 4：存档文件在用户手里，服务器无涉；加密在本地 WebCrypto 完成
// - 格式：'JMLTX' magic + version '1' + fp16(房间哈希指纹, 明文前16位) +
//   kdfSalt(16B) + iv(12B) + AES-256-GCM(JSON)
// - 密钥：PBKDF2-SHA256(房间密码, kdfSalt, 200k) —— 与 NodeCrypt 同强度
// - 房间名不进存档；密码即身份。fp16 用于导入时校验房间匹配
// - 导入按消息 id 去重合并，焚毁/撤回条目导出时即被剔除
// - 明文安全取决于用户保管文件 —— UI 文案必须写明
// - 本模块顶层无 DOM 引用，crypto 部分可在 Node 22 单测

const MAGIC = 'JMLTX';
const VERSION = '1';
const ITERATIONS = 200000;

async function deriveKey(password, kdfSalt, fp16) {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey(
		'raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
	// salt binds to the app purpose + room fingerprint + per-export randomness
	// 盐绑定用途 + 房间指纹 + 每次导出的随机数
	const salt = new Uint8Array(enc.encode('jmlt-export:v1:' + fp16 + ':'));
	const full = new Uint8Array(salt.length + kdfSalt.length);
	full.set(salt, 0);
	full.set(kdfSalt, salt.length);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: full, iterations: ITERATIONS, hash: 'SHA-256' },
		baseKey, 256);
	return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// Pure: collect exportable messages from a room's in-memory buffer.
// Exportable: text / image / voice entries with content; system entries keep
// their text (useful context); file transfers are NOT exportable (volume data
// is not retained) — counted in `skipped`.
// 纯函数：从房间内存缓冲收集可导出消息。文件传输不可导出（分卷不保留），
// 计入 skipped。
export function collectExportMessages(rd) {
	const msgs = [];
	let skipped = 0;
	if (!rd || !Array.isArray(rd.messages)) return { msgs, skipped };
	for (const m of rd.messages) {
		if (!m || m.burned || m.deleted) continue; // 焚毁/撤回不进存档
		if (m.type === 'system') {
			if (typeof m.text === 'string' && m.text) {
				msgs.push({ k: 's', x: m.text, ts: m.timestamp || Date.now() })
			}
			continue
		}
		const mt = m.msgType || 'text';
		if (mt === 'file' || mt === 'file_private') { skipped++; continue }
		let x = null;
		if (typeof m.text === 'string') x = m.text;
		else if (m.text && typeof m.text === 'object') x = m.text; // image/voice payload
		else continue;
		msgs.push({
			k: m.type === 'me' ? 'me' : 'other',
			t: mt,
			x,
			u: m.type === 'me' ? (rd.myUserName || '') : (m.userName || ''),
			ts: m.timestamp || Date.now(),
			id: m.id || null,
			q: m.quote ? { u: m.quote.u, x: String(m.quote.x).slice(0, 200) } : null,
			ttl: m.ttl || null,
			e: !!m.edited
		})
	}
	return { msgs, skipped }
}

// Pure: serialize the archive JSON (what gets encrypted).
// 纯函数：序列化存档 JSON（将被加密的内容）。
export function serializeArchive(fp, msgs, skipped) {
	return JSON.stringify({
		v: 1,
		fp,
		ts: Date.now(),
		skipped,
		n: msgs.length,
		msgs
	})
}

// Pure: validate the decrypted archive object.
// 纯函数：校验解密后的存档对象。
export function validateArchivePayload(payload, expectFp) {
	if (!payload || typeof payload !== 'object') return null;
	if (payload.v !== 1) return null;
	if (typeof payload.fp !== 'string' || payload.fp.length !== 64) return null;
	if (expectFp && payload.fp !== expectFp) return null;
	if (!Array.isArray(payload.msgs)) return null;
	// hard cap: 50k entries — a crafted archive can't blow up merge loops
	// 上限 5 万条：防恶意超大存档拖垮合并
	if (payload.msgs.length > 50000) return null;
	const clean = [];
	for (const m of payload.msgs) {
		if (!m || typeof m !== 'object') continue;
		if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) continue;
		if (m.k === 's') {
			if (typeof m.x === 'string') clean.push({ k: 's', x: m.x.slice(0, 2000), ts: m.ts });
			continue
		}
		if (m.k !== 'me' && m.k !== 'other') continue;
		if (typeof m.x !== 'string' && (m.x === null || typeof m.x !== 'object')) continue;
		if (typeof m.x === 'string' && m.x.length > 100000) continue;
		const t = typeof m.t === 'string' ? m.t : 'text';
		if (!/^(text|image|image_private|voice|voice_private|text_private)$/.test(t)) continue;
		clean.push({
			k: m.k, t, x: m.x,
			u: typeof m.u === 'string' ? m.u.slice(0, 64) : '',
			ts: m.ts,
			id: typeof m.id === 'string' && /^[A-Za-z0-9]{8,32}$/.test(m.id) ? m.id : null,
			q: (m.q && typeof m.q === 'object') ? { u: String(m.q.u || '').slice(0, 64), x: String(m.q.x || '').slice(0, 200) } : null,
			ttl: (typeof m.ttl === 'number' && m.ttl > 0) ? m.ttl : null,
			e: !!m.e
		})
	}
	return { fp: payload.fp, msgs: clean, skipped: payload.skipped | 0 }
}

// Pure: parse the binary container (no crypto). Returns null on bad header.
// 纯函数：解析二进制容器（不含解密）。头不对返回 null。
export function parseArchiveContainer(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 5 + 1 + 16 + 16 + 12 + 16) return null;
	const dec = new TextDecoder();
	if (dec.decode(bytes.slice(0, 5)) !== MAGIC) return null;
	if (String.fromCharCode(bytes[5]) !== VERSION) return null;
	let off = 6;
	const fp16 = dec.decode(bytes.slice(off, off + 16)); off += 16;
	const kdfSalt = bytes.slice(off, off + 16); off += 16;
	const iv = bytes.slice(off, off + 12); off += 12;
	const ct = bytes.slice(off);
	return { fp16, kdfSalt, iv, ct }
}

// Encrypt serialized JSON into container bytes.
export async function encryptArchive(jsonStr, password, fp) {
	const fp16 = String(fp).slice(0, 16);
	const kdfSalt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(password, kdfSalt, fp16);
	const ct = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv }, key, new TextEncoder().encode(jsonStr)));
	const head = new TextEncoder().encode(MAGIC + VERSION + fp16);
	const out = new Uint8Array(head.length + kdfSalt.length + iv.length + ct.length);
	let off = 0;
	out.set(head, off); off += head.length;
	out.set(kdfSalt, off); off += kdfSalt.length;
	out.set(iv, off); off += iv.length;
	out.set(ct, off);
	return out
}

// Decrypt container bytes back to the validated payload. Throws on wrong
// password / tampering (AES-GCM auth failure).
// 解密容器。密码错误或篡改都会在 AES-GCM 认证处抛错。
export async function decryptArchive(bytes, password, expectFp) {
	const c = parseArchiveContainer(bytes);
	if (!c) throw new Error('bad archive header');
	const key = await deriveKey(password, c.kdfSalt, c.fp16);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, key, c.ct);
	const payload = JSON.parse(new TextDecoder().decode(plain));
	const fullFp = expectFp || null;
	// if we know the room hash, require a full match; otherwise the fp16 in
	// the header already matched the container, and the JSON fp must extend it
	const v = validateArchivePayload(payload, fullFp);
	if (!v) throw new Error('archive payload invalid');
	if (v.fp.slice(0, 16) !== c.fp16) throw new Error('fingerprint mismatch');
	return v
}

// Pure: merge validated archive entries into a room's message buffer,
// deduping by id. Entries without id are always appended (they cannot be
// deduped) — capped to avoid flooding.
// 纯函数：把校验过的存档条目按 id 去重合并进房间消息缓冲；无 id 条目直接
// 追加（无法去重），总量封顶防灌水。
export function mergeArchiveMessages(existing, entries, cap = 5000) {
	const known = new Set();
	if (Array.isArray(existing)) {
		for (const m of existing) {
			if (m && typeof m.id === 'string') known.add(m.id)
		}
	}
	const toAppend = [];
	let dup = 0;
	for (const m of entries) {
		if (toAppend.length >= cap) break;
		if (m.id) {
			if (known.has(m.id)) { dup++; continue }
			known.add(m.id)
		}
		toAppend.push(m)
	}
	return { toAppend, dup }
}

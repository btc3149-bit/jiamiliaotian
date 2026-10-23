// ==================== v1.4.0 #14: Room credential migration (QR + file) ====================
// v1.4.0 #14：房间凭据迁移（二维码 + 文件）。
//
// SECURITY / RULES.md 对照：
// - 载荷 = { v, n:房间名, p:房间密码, u:用户名?, ts }，用「迁移专用随机密钥」
//   AES-256-GCM 加密（PBKDF2-SHA256 200k，salt 域分离 'jmlt-migrate:v1:'）。
// - QR 内容是一个 URL 片段（#jmlt=...）——fragment 永远不会发给服务器，
//   手机原生相机扫码 → 直接打开本应用 → 自动填入登录表单。
// - 有效期 10 分钟：payload 内嵌时间戳，解密端强制校验，过期拒绝。
// - **绝不迁移服务器 pin**：新设备走正常 TOFU 首连，信任链从新建立——
//   防止「信任被复制」（不变量 3 的显式设计，不是偷懒）。
// - 不变量 4 ✓（服务器无涉）、2 ✓（AES-GCM）、6 ✓（qrcode-generator 已审）。

import qrcode from 'qrcode-generator';
import { t } from './util.i18n.js';

export const MIGRATION_MAGIC = 'JMLTK';       // 5-byte ASCII magic
export const MIGRATION_VERSION = 1;
export const MIGRATION_TTL_MS = 10 * 60 * 1000; // QR/file valid for 10 minutes

// ---- base64 helpers (binary-safe, browser + Node 18+) ----
export function bytesToB64(bytes) {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}
export function b64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function concatBytes(...arrays) {
	let total = 0;
	for (const a of arrays) total += a.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) { out.set(a, off); off += a.length; }
	return out;
}

function asciiBytes(s) {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
	return out;
}

async function deriveMigrationKey(keyString, salt) {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey(
		'raw', enc.encode(String(keyString)), 'PBKDF2', false, ['deriveKey']);
	// Domain-separated salt: same key string must never yield a key usable on
	// other formats (archive export uses its own 'jmlt-export:v1:' domain).
	// 域分离 salt：同一个密钥字符串派生不出其他格式（加密存档用独立域）可用的钥匙。
	const saltBytes = concatBytes(asciiBytes('jmlt-migrate:v1:'), salt);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: saltBytes, iterations: 200000, hash: 'SHA-256' },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

// ---- payload build / validate (pure, unit-tested) ----
export function buildMigrationPayload(roomName, password, username, nowMs) {
	return {
		v: 1,
		n: String(roomName || '').slice(0, 64),
		p: String(password || '').slice(0, 64),
		u: String(username || '').slice(0, 15),
		ts: (typeof nowMs === 'number' && nowMs > 0) ? Math.floor(nowMs) : Date.now()
	};
}

// Pure validation for a decrypted payload. Returns null when invalid.
// 解密后载荷的纯校验，非法返回 null。
export function validateMigrationPayload(payload, nowMs = Date.now()) {
	if (!payload || typeof payload !== 'object' || payload.v !== 1) return null;
	if (typeof payload.n !== 'string' || !payload.n.trim() || payload.n.length > 64) return null;
	if (typeof payload.p !== 'string' || payload.p.length > 64) return null;
	if (typeof payload.u !== 'string' || payload.u.length > 15) return null;
	if (typeof payload.ts !== 'number' || !Number.isFinite(payload.ts)) return null;
	const ts = Math.floor(payload.ts);
	// expired? (payload timestamp too old) / 过期拒绝
	if (nowMs - ts > MIGRATION_TTL_MS) return null;
	// clock-skew guard: reject timestamps far in the future / 未来时间戳防钟差
	if (ts - nowMs > 5 * 60 * 1000) return null;
	return { roomName: payload.n.trim(), password: payload.p, username: payload.u, ts };
}

// ---- encrypt / decrypt (container: magic + version + salt16 + iv12 + ct) ----
export async function encryptMigration(payloadObj, keyString) {
	const json = JSON.stringify(payloadObj);
	const enc = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const aesKey = await deriveMigrationKey(keyString, salt);
	const ct = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv }, aesKey, enc.encode(json)));
	return concatBytes(asciiBytes(MIGRATION_MAGIC), new Uint8Array([MIGRATION_VERSION]), salt, iv, ct);
}

// Throws Error('expired') on TTL failure; Error('bad-format') on structure
// failure; Error('bad-key') on GCM auth failure (wrong key or tampered).
// 过期抛 'expired'；结构非法抛 'bad-format'；GCM 认证失败（错钥/篡改）抛 'bad-key'。
export async function decryptMigration(bytes, keyString, nowMs = Date.now()) {
	if (!(bytes instanceof Uint8Array) || bytes.length < MIGRATION_MAGIC.length + 1 + 16 + 12 + 16) {
		throw new Error('bad-format');
	}
	const magic = String.fromCharCode(...bytes.slice(0, MIGRATION_MAGIC.length));
	if (magic !== MIGRATION_MAGIC) throw new Error('bad-format');
	if (bytes[MIGRATION_MAGIC.length] !== MIGRATION_VERSION) throw new Error('bad-format');
	let off = MIGRATION_MAGIC.length + 1;
	const salt = bytes.slice(off, off + 16); off += 16;
	const iv = bytes.slice(off, off + 12); off += 12;
	const ct = bytes.slice(off);
	const aesKey = await deriveMigrationKey(keyString, salt);
	let plain;
	try {
		plain = new Uint8Array(await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv }, aesKey, ct));
	} catch (_e) {
		throw new Error('bad-key');
	}
	let payload;
	try {
		payload = JSON.parse(new TextDecoder().decode(plain));
	} catch (_e) {
		throw new Error('bad-format');
	}
	const clean = validateMigrationPayload(payload, nowMs);
	if (!clean) throw new Error('expired');
	return clean;
}

// ---- QR text: an app URL carrying the ciphertext in the fragment ----
// QR 内容：携带密文的本应用 URL（fragment 不会发往服务器）。
export function buildMigrationUrl(bytes) {
	let base = '';
	try {
		base = location.origin + location.pathname;
	} catch (_e) {
		base = './';
	}
	return base + '#jmlt=' + bytesToB64(bytes);
}

// Parse a migration URL/text into bytes. Accepts the raw base64 as well.
// 从迁移 URL/文本中解析出密文字节；也接受裸 base64。
export function parseMigrationText(text) {
	const s = String(text || '').trim();
	const idx = s.indexOf('#jmlt=');
	if (idx !== -1) return b64ToBytes(s.slice(idx + '#jmlt='.length));
	if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 40) return b64ToBytes(s);
	return null;
}

// ---- export modal (QR + copy + download) ----
// 导出弹窗：二维码 + 复制链接 + 下载 .jmltk 文件。复用 share-modal 样式。
export function showMigrationModal(bytes) {
	const url = buildMigrationUrl(bytes);
	const prev = document.querySelector('.share-modal-overlay');
	if (prev) prev.remove();
	const overlay = document.createElement('div');
	overlay.className = 'share-modal-overlay';
	let qrSvg = '';
	try {
		const qr = qrcode(0, 'M');
		qr.addData(url);
		qr.make();
		qrSvg = qr.createSvgTag({ cellSize: 4, margin: 8, scannable: true });
	} catch (_e) { /* fall back to copy/download only */ }
	overlay.innerHTML = `
		<div class="share-modal-container">
			<div class="share-modal-header">
				<h3>${t('migration.title', 'Room Credentials — Migration')}</h3>
				<button class="share-modal-close" type="button" aria-label="Close">&times;</button>
			</div>
			<div class="share-modal-body">
				${qrSvg ? `<div class="share-qr-box">${qrSvg}</div><div class="share-qr-hint" data-mig="hint"></div>` : `<div class="share-qr-hint" data-mig="hint"></div>`}
				<div class="share-link-box" title="migration link">${url.replace(/[<>&]/g, '')}</div>
				<div class="migration-btn-row">
					<button class="share-copy-btn" type="button" data-mig="copy"></button>
					<button class="share-copy-btn" type="button" data-mig="dl"></button>
				</div>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);
	const hintEl = overlay.querySelector('[data-mig="hint"]');
	if (hintEl) hintEl.textContent = t('migration.qr_hint', 'Scan with the other device (valid 10 minutes), or use the file / link below.');
	const copyBtn = overlay.querySelector('[data-mig="copy"]');
	if (copyBtn) {
		copyBtn.textContent = t('migration.copy', 'Copy Link');
		copyBtn.addEventListener('click', () => {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(url).catch(() => { /* best-effort */ });
			} else if (typeof window.prompt === 'function') {
				window.prompt(t('action.copy_url_failed', 'Copy failed, url:'), url);
			}
		});
	}
	const dlBtn = overlay.querySelector('[data-mig="dl"]');
	if (dlBtn) {
		dlBtn.textContent = t('migration.download', 'Download File (.jmltk)');
		dlBtn.addEventListener('click', () => {
			const blob = new Blob([bytes], { type: 'application/octet-stream' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = 'jiamiliaotian-credentials-' + Date.now() + '.jmltk';
			document.body.appendChild(a);
			a.click();
			setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
		});
	}
	const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
	const escHandler = (e) => { if (e.key === 'Escape') close(); };
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
	const closeBtn = overlay.querySelector('.share-modal-close');
	if (closeBtn) closeBtn.addEventListener('click', close);
	document.addEventListener('keydown', escHandler);
}

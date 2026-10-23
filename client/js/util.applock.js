// ==================== v1.4.0 #3: App Lock (WebAuthn local lock) ====================
// v1.4.0 #3：应用锁（WebAuthn 本地锁）。
//
// SECURITY / RULES.md 对照：
// - 凭据仅存本机：navigator.credentials.create() 注册平台验证器（指纹/面容/
//   Windows Hello/安卓生物识别），rawId 存 localStorage，绝无服务器注册。
// - 解锁 = credentials.get() 的 userPresence/userVerification 语义——「本人
//   还在设备前」的存在性证明，不是加密升级。
// - 诚实边界（设置面板明示）：防顺手看，不防取证、不防 DevTools——密钥材料
//   本来就不落盘，锁的是 UI，不是数据。
// - 锁定触发：手动锁 / 切后台超 5 分钟。
// - 零新依赖（浏览器原生 WebAuthn），不变量 6 ✓；服务器零改动 ✓。
//
// HONEST LIMITS: this is a shoulder-surfing guard, not a security boundary.
// A user with DevTools access can remove the overlay. Documented in settings.

import { t } from './util.i18n.js';

const CRED_KEY = 'jmlt_applock_cred';   // localStorage key for the credential id
export const LOCK_AFTER_HIDDEN_MS = 5 * 60 * 1000; // lock after 5 min hidden

let lockOverlay = null;
let unlockInFlight = false;
let failCount = 0;

// ---- storage helpers ----
function getCredIdB64() {
	try { return localStorage.getItem(CRED_KEY) || ''; } catch (_e) { return ''; }
}

export function isAppLockEnabled() {
	return !!getCredIdB64();
}

export function isAppLockSupported() {
	return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

// base64 <-> ArrayBuffer (binary-safe)
function bufToB64(buf) {
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}
function b64ToBuf(b64) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}

function randomChallenge() {
	return crypto.getRandomValues(new Uint8Array(32));
}

// ---- registration (enable) ----
// Registers a platform-authenticator credential. The attestation object is
// NOT verified — there is no server, this is purely a local presence proof.
// 注册平台验证器凭据。不验证 attestation——没有服务器，纯粹是本地存在性证明。
export async function enableAppLock() {
	if (!isAppLockSupported()) {
		throw new Error('unsupported');
	}
	const cred = await navigator.credentials.create({
		publicKey: {
			challenge: randomChallenge(),
			rp: { name: 'jiamiliaotian' },
			user: {
				id: crypto.getRandomValues(new Uint8Array(16)),
				name: 'app-lock',
				displayName: 'App Lock'
			},
			pubKeyCredParams: [
				{ type: 'public-key', alg: -7 },    // ES256
				{ type: 'public-key', alg: -257 }   // RS256
			],
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				userVerification: 'required',
				residentKey: 'discouraged'
			},
			timeout: 60000,
			attestation: 'none'
		}
	});
	if (!cred) throw new Error('no-credential');
	try {
		localStorage.setItem(CRED_KEY, bufToB64(cred.rawId));
	} catch (e) {
		throw new Error('storage');
	}
	return true;
}

export function disableAppLock() {
	try { localStorage.removeItem(CRED_KEY); } catch (_e) { /* ignore */ }
	hideLockOverlay();
	return true;
}

// ---- lock / unlock ----
export function lockNow() {
	if (!isAppLockEnabled()) return false;
	showLockOverlay();
	return true;
}

function showLockOverlay() {
	if (lockOverlay) return;
	const overlay = document.createElement('div');
	overlay.className = 'applock-overlay';
	overlay.innerHTML = `
		<div class="applock-card">
			<div class="applock-icon">🔒</div>
			<div class="applock-title">${t('applock.title', 'Locked')}</div>
			<div class="applock-hint">${t('applock.hint', 'Unlock with your device authenticator (fingerprint / face / PIN)')}</div>
			<button type="button" class="applock-unlock-btn">${t('applock.unlock', 'Unlock')}</button>
			<div class="applock-error" style="display:none"></div>
			<button type="button" class="applock-emergency" style="display:none">${t('applock.emergency', 'Locked out? Erase all local app data')}</button>
		</div>
	`;
	document.body.appendChild(overlay);
	lockOverlay = overlay;
	const errEl = overlay.querySelector('.applock-error');
	const emBtn = overlay.querySelector('.applock-emergency');
	const showErr = (msg) => {
		if (!errEl) return;
		errEl.textContent = msg;
		errEl.style.display = '';
	};
	overlay.querySelector('.applock-unlock-btn').addEventListener('click', async () => {
		if (unlockInFlight) return;
		unlockInFlight = true;
		try {
			const credIdB64 = getCredIdB64();
			if (!credIdB64) { hideLockOverlay(); return }
			await navigator.credentials.get({
				publicKey: {
					challenge: randomChallenge(),
					allowCredentials: [{ type: 'public-key', id: b64ToBuf(credIdB64) }],
					userVerification: 'required',
					timeout: 60000
				}
			});
			failCount = 0;
			if (emBtn) emBtn.style.display = 'none';
			hideLockOverlay();
		} catch (_e) {
			failCount++;
			showErr(t('applock.failed', 'Unlock failed — try again.') + (failCount >= 2 ? ' (' + failCount + ')' : ''));
			if (emBtn && failCount >= 2) emBtn.style.display = '';
		} finally {
			unlockInFlight = false;
		}
	});
	if (emBtn) {
		emBtn.addEventListener('click', async () => {
			// Authenticator gone (e.g. biometrics reset): the only honest way
			// back is the same panic-wipe path as feature #2 — explicit, loud.
			// 验证器没了（如生物识别重置）：唯一诚实的出路是走 #2 的恐慌清除。
			const ok = window.confirm(t('applock.emergency_confirm',
				'This erases ALL local app data (pins, settings, history, caches) and disables App Lock. Continue?'));
			if (!ok) return;
			disableAppLock();
			try {
				const mod = await import('./util.panic.js');
				await mod.panicWipe();
			} catch (_e) {
				try { localStorage.clear(); } catch (_e2) { /* ignore */ }
				location.reload();
			}
		});
	}
}

function hideLockOverlay() {
	if (lockOverlay) {
		lockOverlay.remove();
		lockOverlay = null;
		unlockInFlight = false;
		failCount = 0;
	}
}

// ---- background auto-lock timer ----
let hiddenTimer = null;

function onVisibilityChange() {
	if (document.visibilityState === 'hidden') {
		if (!isAppLockEnabled()) return;
		if (hiddenTimer) clearTimeout(hiddenTimer);
		hiddenTimer = setTimeout(() => {
			hiddenTimer = null;
			// fires while hidden — overlay appears when the user returns
			lockNow();
		}, LOCK_AFTER_HIDDEN_MS);
	} else {
		if (hiddenTimer) {
			clearTimeout(hiddenTimer);
			hiddenTimer = null;
		}
	}
}

// Boot: wire the visibility auto-lock. Called once from main.js.
export function initAppLock() {
	document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('pagehide', () => {
		if (isAppLockEnabled()) lockNow();
	});
}

// ---- testable pure helper: should the app lock now? ----
// v1.4.0: pure decision used by tests (hidden duration past threshold).
// v1.4.0：纯函数判定（后台时长是否超过阈值），供单测。
export function shouldLockAfterHidden(hiddenAt, now, threshold = LOCK_AFTER_HIDDEN_MS) {
	if (typeof hiddenAt !== 'number' || hiddenAt <= 0) return false;
	if (typeof now !== 'number' || now < hiddenAt) return false;
	return (now - hiddenAt) >= threshold;
}

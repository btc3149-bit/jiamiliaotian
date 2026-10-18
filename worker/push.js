// Web Push sender (RFC 8291 payload-free variant + RFC 8292 VAPID).
//
// DESIGN DECISION — EMPTY PAYLOAD ONLY:
// We send NO encrypted payload. The push body is empty; the sole purpose is
// to wake the service worker, which then shows a GENERIC "you have a new
// message" notification (suppressed entirely when the app is visible).
// Consequences, all intentional (RULES.md 第一准则):
// - The push service (Google/Mozilla/Apple) learns nothing: no room, no
//   sender, no content, not even a payload ciphertext to analyze.
// - We never store the subscription's p256dh/auth keys — the only thing the
//   DO keeps is the opaque endpoint URL, over the E2EE channel.
// - No aes128gcm payload encryption code to audit.
//
// 只发空 payload 的 Web Push：推送服务零信息（无房间/无发送者/无内容），
// DO 不存 p256dh/auth 密钥，payload 端到端加密代码整个不存在。

const VAPID_EXP_SECONDS = 12 * 60 * 60; // auth JWT lifetime / 签名有效期

function bytesToBase64Url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(obj) {
	return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

// Build the RFC 8292 `Authorization: vapid t=<jwt>, k=<pubkey>` header.
// 构造 VAPID 授权头（ES256 JWT，WebCrypto 原生签名，无第三方依赖）。
export async function buildVapidAuthorization(endpoint, vapid) {
	const endpointUrl = new URL(endpoint);
	const header = jsonToBase64Url({ typ: 'JWT', alg: 'ES256' });
	const payload = jsonToBase64Url({
		aud: endpointUrl.origin,
		exp: Math.floor(Date.now() / 1000) + VAPID_EXP_SECONDS,
		sub: 'mailto:admin@jiamiliaotian.local'
	});
	const signingInput = header + '.' + payload;
	const privateKey = await crypto.subtle.importKey(
		'jwk',
		vapid.privateKey,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	// WebCrypto ECDSA returns IEEE P1363 raw r||s (64 bytes for P-256) —
	// exactly what JWT ES256 requires, no DER conversion needed.
	const signature = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput))
	);
	return 'vapid t=' + signingInput + '.' + bytesToBase64Url(signature) + ', k=' + vapid.publicKey;
}

// Fire an empty-payload push at a subscription endpoint.
// Returns the HTTP status so the caller can prune dead subscriptions.
// 向订阅端点发一次空 payload 推送，返回状态码供调用方清理失效订阅。
export async function sendWebPush(endpoint, vapid) {
	if (!isAcceptableEndpoint(endpoint)) {
		return 400;
	}
	try {
		const authorization = await buildVapidAuthorization(endpoint, vapid);
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'TTL': '86400',
				'Urgency': 'normal',
				'Authorization': authorization
			}
			// no body — the emptiness IS the privacy feature / 无 body 正是隐私设计
		});
		return response.status;
	} catch (error) {
		logPushError('sendWebPush', error);
		return 0;
	}
}

// Endpoint allowlist check. Subscription endpoints come from the browser and
// are stored in DO storage, so they get the same input hardening as anything
// else: https only, length cap. (Worker outbound fetch is not CSP-bound, but
// we still refuse anything that is not a real push-service URL shape.)
// 端点准入校验：仅 https、限长；订阅端点属于外部输入，照常加固。
export function isAcceptableEndpoint(endpoint) {
	if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 500) {
		return false;
	}
	let parsed;
	try {
		parsed = new URL(endpoint);
	} catch (_) {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	if (parsed.username || parsed.password) return false;
	return true;
}

function logPushError(source, error) {
	try {
		console.error(`[ERROR] ${source}: ${String(error && error.name ? error.name : 'error')}`);
	} catch (_) { /* logging must never throw */ }
}

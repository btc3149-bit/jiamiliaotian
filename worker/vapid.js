// VAPID keystore Durable Object.
//
// Web Push requires a VAPID keypair (ES256 / ECDSA P-256). The key must be
// GLOBAL (shared by every room DO) because a browser subscription is created
// with one applicationServerKey and every later push must be signed by the
// matching private key. Room DOs therefore ask this dedicated singleton DO
// for the keys; the keystore lazily generates and persists them on first use.
//
// SECURITY (RULES.md): the VAPID key authenticates our push *sender* identity
// to the push service. It never touches message content — pushes carry an
// EMPTY payload, so the push service learns nothing beyond "some tab of this
// browser subscribed somewhere". Public key is exported raw (uncompressed
// point) because that is the exact encoding pushManager.subscribe expects.
//
// VAPID 密钥库 Durable Object。密钥全局共享（浏览器订阅绑定单一
// applicationServerKey），由本单例 DO 懒生成并持久化。推送 payload 为空，
// 推送服务除「该浏览器订阅过」外无从得知任何信息。

const KEY_STORAGE_ID = 'vapidKeyPair';

export class VapidStore {
	constructor(state, env) {
		this.state = state;
		this.env = env;
	}

	async fetch() {
		try {
			let stored = await this.state.storage.get(KEY_STORAGE_ID);
			if (!stored) {
				const keyPair = await crypto.subtle.generateKey(
					{ name: 'ECDSA', namedCurve: 'P-256' },
					true,
					['sign']
				);
				const [privateJwk, publicRaw] = await Promise.all([
					crypto.subtle.exportKey('jwk', keyPair.privateKey),
					crypto.subtle.exportKey('raw', keyPair.publicKey)
				]);
				stored = {
					// base64url of the uncompressed public point = applicationServerKey
					publicKey: bufferToBase64Url(new Uint8Array(publicRaw)),
					privateKey: privateJwk,
					createdAt: Date.now()
				};
				await this.state.storage.put(KEY_STORAGE_ID, stored);
			}
			return new Response(JSON.stringify({
				publicKey: stored.publicKey,
				privateKey: stored.privateKey
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			logEvent('vapid-store', error, 'error');
			return new Response('vapid store error', { status: 500 });
		}
	}
}

function bufferToBase64Url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function logEvent(source, message, level) {
	// Never log key material or any content — op name / error class only.
	// 绝不记录密钥或任何内容，仅记操作名与错误类别。
	try {
		console.error(`[${(level || 'info').toUpperCase()}] ${source}: ${String(message && message.name ? message.name : 'error')}`);
	} catch (_) { /* logging must never throw */ }
}

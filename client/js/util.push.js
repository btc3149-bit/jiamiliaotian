// util.push.js — Web Push 订阅管理（P1-C）
//
// 隐私设计（RULES.md 第一准则对照）：
// - 订阅端点经既有 E2EE 通道上报（NodeCrypt.sendPushSubscribe），服务器
//   只能拿到不透明端点 URL；推送 payload 为空，推送服务零信息。
// - 开关由用户在设置面板显式开启，不自动弹权限框。
// - 订阅状态只存 localStorage 布尔值，不存任何端点/密钥材料。

const LS_PUSH_ENABLED = 'jmlt_push_enabled';

let vapidKeyPromise = null;

// Feature detection / 能力检测
export function isPushSupported() {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

export function isPushEnabled() {
	try {
		return localStorage.getItem(LS_PUSH_ENABLED) === '1';
	} catch (_e) {
		return false;
	}
}

// base64url → Uint8Array（applicationServerKey 要求 raw 编码）
function urlBase64ToUint8Array(base64UrlString) {
	const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
	const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const output = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
	return output;
}

// 从服务器取 VAPID 公钥（public by design，缓存进程内）。
// P1-D: 桌面壳下用 JMLT_SERVER_URL 覆盖（页面本身是本地资源）。
async function getVapidPublicKey() {
	if (!vapidKeyPromise) {
		const base = (typeof window !== 'undefined' && window.JMLT_SERVER_URL) || '';
		vapidKeyPromise = fetch(base + '/api/vapid', { credentials: 'same-origin' })
			.then((res) => {
				if (!res.ok) throw new Error('vapid-unavailable');
				return res.json();
			})
			.then((data) => {
				if (!data || typeof data.publicKey !== 'string' || data.publicKey.length < 40) {
					throw new Error('vapid-invalid');
				}
				return urlBase64ToUint8Array(data.publicKey);
			})
			.catch((err) => {
				vapidKeyPromise = null; // allow retry / 允许重试
				throw err;
			});
	}
	return vapidKeyPromise;
}

async function getActiveSubscription() {
	const reg = await navigator.serviceWorker.ready;
	return reg.pushManager.getSubscription();
}

// 开启推送：请求权限 → 订阅 → 标记 → 向已连接房间上报
export async function enablePush() {
	if (!isPushSupported()) {
		throw new Error('push-unsupported');
	}
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		throw new Error('push-denied');
	}
	const reg = await navigator.serviceWorker.ready;
	const applicationServerKey = await getVapidPublicKey();
	let sub = await reg.pushManager.getSubscription();
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey
		});
	}
	try {
		localStorage.setItem(LS_PUSH_ENABLED, '1');
	} catch (_e) { /* storage may be blocked; session-only push then */ }
	reportPushSubscriptionToAllRooms();
	return sub.endpoint;
}

// 关闭推送：退订 → 上报退订 → 清标记
export async function disablePush() {
	try {
		localStorage.setItem(LS_PUSH_ENABLED, '0');
	} catch (_e) { /* ignore */ }
	let endpoint = null;
	try {
		const sub = await getActiveSubscription();
		if (sub) {
			endpoint = sub.endpoint;
			await sub.unsubscribe();
		}
	} catch (_e) { /* best effort */ }
	reportPushUnsubscriptionToAllRooms(endpoint);
}

// 房间表访问器注入（避免与 room.js 形成模块环；main.js 负责注入）
let roomListAccessor = null;
export function registerRoomListAccessor(fn) {
	roomListAccessor = typeof fn === 'function' ? fn : null;
}

function eachLiveRoom(cb) {
	const rooms = roomListAccessor ? roomListAccessor() : null;
	if (!Array.isArray(rooms)) return;
	for (const rd of rooms) {
		if (rd && rd.chat) cb(rd.chat)
	}
}

// 把当前订阅端点经 E2EE 通道上报给指定房间的 chat 实例。
// room.js 在房间初始化完成后调用。
export async function reportPushSubscription(chatInst) {
	if (!chatInst || !isPushEnabled() || !isPushSupported()) return;
	try {
		const sub = await getActiveSubscription();
		if (sub && typeof chatInst.sendPushSubscribe === 'function') {
			chatInst.sendPushSubscribe(sub.endpoint);
		}
	} catch (_e) { /* push reporting is best-effort, never blocks chat */ }
}

// 遍历所有已连接房间上报订阅（开关打开时）
export function reportPushSubscriptionToAllRooms() {
	eachLiveRoom((chat) => reportPushSubscription(chat));
}

// 遍历所有已连接房间上报退订
export function reportPushUnsubscriptionToAllRooms(endpoint) {
	if (!endpoint) return;
	eachLiveRoom((chat) => {
		if (typeof chat.sendPushUnsubscribe === 'function') {
			chat.sendPushUnsubscribe(endpoint)
		}
	});
}

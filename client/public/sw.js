// 加米辽田 Service Worker
//
// 安全边界（RULES.md 第一准则对照）：
// - 本 SW 只缓存「静态应用壳」：HTML/CSS/JS/图标/字体等不变的资源文件。
// - 绝不缓存任何消息内容、房间凭据、密钥材料或用户数据——这些只存在于
//   页面内存 / sessionStorage / localStorage（且 localStorage 中的历史本身已加密）。
// - WebSocket 连接与所有动态请求一律直连网络，SW 不拦截、不落盘。
// - 缓存键带版本号，发版后旧缓存整体清除，避免新旧资源错配。

const VERSION = 'jmlt-pwa-v2';
const SHELL_CACHE = `${VERSION}-shell`;

// 预缓存：应用入口 + 清单 + 图标。JS/CSS 由运行时 SWR 策略补充。
const PRECACHE = [
	'./',
	'./index.html',
	'./manifest.webmanifest',
	'./icons/icon-192.png',
	'./icons/icon-512.png'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(SHELL_CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(
			keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
		);
		await self.clients.claim();
	})());
});

self.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ==================== Web Push (P1-C) ====================
// 推送 payload 为空（服务器零知识设计）——本 handler 只做两件事：
// 1) 应用在前台可见时静默吞掉推送（零打扰）；
// 2) 否则弹一条泛化通知：「有新消息」。不含房间名、发送者、内容，
//    因为推送本身就不携带任何这些信息。
self.addEventListener('push', (event) => {
	event.waitUntil((async () => {
		let visible = false;
		try {
			const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			visible = clientList.some((c) => c.visibilityState === 'visible');
		} catch (_err) {
			visible = false;
		}
		if (visible) return;
		await self.registration.showNotification('加米辽田', {
			body: '💬 你有新消息 / You have a new message',
			icon: './icons/icon-192.png',
			badge: './icons/icon-192.png',
			tag: 'jmlt-new-message',
			renotify: false
		});
	})());
});

// 点击通知：聚焦已有窗口或打开应用
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil((async () => {
		const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
		for (const client of clientList) {
			if ('focus' in client) return client.focus();
		}
		return self.clients.openWindow('./');
	})());
});

// 静态资源扩展名白名单（含 vite 产物 hash 文件名）
const STATIC_EXT = /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|webmanifest)$/i;

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);

	// 跨域请求（如 CDN、头像服务）不拦截
	if (url.origin !== self.location.origin) return;

	// 保险丝：任何 API 路径、WebSocket 升级、带查询串的动态请求一律直连
	if (url.pathname.includes('/api/')) return;

	// 页面导航：network-first，离线时回退缓存的入口页
	if (req.mode === 'navigate') {
		event.respondWith((async () => {
			try {
				const fresh = await fetch(req);
				const cache = await caches.open(SHELL_CACHE);
				cache.put('./index.html', fresh.clone()).catch(() => {});
				return fresh;
			} catch (_err) {
				const cache = await caches.open(SHELL_CACHE);
				return (await cache.match('./'))
					|| (await cache.match('./index.html'))
					|| Response.error();
			}
		})());
		return;
	}

	// 静态资源：stale-while-revalidate（命中缓存立即返回，后台刷新）
	const isStatic = STATIC_EXT.test(url.pathname)
		|| ['style', 'script', 'image', 'font'].includes(req.destination);
	if (isStatic) {
		event.respondWith((async () => {
			const cache = await caches.open(SHELL_CACHE);
			const cached = await cache.match(req);
			const network = fetch(req).then((res) => {
				if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
				return res;
			}).catch(() => undefined);
			return cached || (await network) || Response.error();
		})());
	}
});

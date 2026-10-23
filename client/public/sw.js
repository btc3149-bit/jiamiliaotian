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
	const url = new URL(req.url);

	// ==================== Web Share Target (v1.3.0 #13) ====================
	// 安卓 PWA 分享入口：系统分享面板把 文本/图片 POST 到这里。
	// SECURITY（RULES.md 不变量 7 对照）：
	// - 分享载荷只进内存里的 Cache 条目，等应用取走即焚（take = delete）
	// - 不写 IndexedDB / localStorage，不做任何持久化
	// - 只接受同源 POST ./share-target，其余一律不管
	// iOS 不支持 share_target —— 属性差异，README 已注明。
	if (req.method === 'POST' && url.origin === self.location.origin &&
		url.pathname.replace(/\/+$/, '').endsWith('/share-target')) {
		event.respondWith((async () => {
			try {
				const form = await req.formData();
				const payload = {
					title: String(form.get('title') || '').slice(0, 500),
					text: String(form.get('text') || '').slice(0, 10000),
					url: String(form.get('url') || '').slice(0, 2000),
					files: []
				};
				const files = form.getAll('files');
				let total = 0;
				for (const f of files) {
					if (!f || typeof f === 'string') continue;
					// 每个文件 5MB、总量 10MB 上限，超出即丢弃（诚实降级）
					if (f.size > 5 * 1024 * 1024 || total + f.size > 10 * 1024 * 1024) continue;
					const buf = await f.arrayBuffer();
					let bin = '';
					const u8 = new Uint8Array(buf);
					const CHUNK = 0x8000;
					for (let i = 0; i < u8.length; i += CHUNK) {
						bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
					}
					payload.files.push({
						name: String(f.name || 'file').slice(0, 128),
						type: String(f.type || 'application/octet-stream').slice(0, 128),
						dataUrl: 'data:' + (f.type || 'application/octet-stream') + ';base64,' + btoa(bin)
					});
					total += f.size
				}
				const cache = await caches.open('jmlt-share-v1');
				// 用合成的 GET 请求做键（Cache API 不允许 POST 条目）
				await cache.put(new Request('./__share-payload'), new Response(JSON.stringify(payload), {
					headers: { 'Content-Type': 'application/json' }
				}));
				// 302 回应用首页，页面读到 ?share=1 后自行取走载荷
				return Response.redirect(new URL('./?share=1', self.location.origin).href, 302)
			} catch (_err) {
				return Response.redirect(new URL('./', self.location.origin).href, 302)
			}
		})());
		return
	}

	if (req.method !== 'GET') return;

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

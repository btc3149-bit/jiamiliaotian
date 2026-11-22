// test-share-sw.mjs — S-4 (PR-8) Service Worker share hand-off tests.
// Runs client/public/sw.js inside a node:vm sandbox with mocked SW
// globals (P-8 layering: SW lifecycle cannot run under plain node).
// Covers: share POST stores payload with embedded ts; activate deletes
// the share cache explicitly; TTL helper semantics; oversize files are
// honestly dropped; non-share requests are not intercepted. Page-side
// TTL enforcement lives in client/js/main.js and is asserted statically.
import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ FAIL: ' + name); } }

const swSource = fs.readFileSync(new URL('./client/public/sw.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('./client/js/main.js', import.meta.url), 'utf8');

function makeEnv() {
	const stores = new Map(); // cacheName -> Map(key -> bodyString)
	const listeners = {};
	class MockRequest { constructor(url) { this.url = typeof url === 'string' ? url : url.url; } }
	class MockResponse {
		constructor(body, init = {}) { this.body = body; this.headers = init.headers || {}; this.status = init.status || 200; }
		async json() { return JSON.parse(this.body); }
		static redirect(url, status) { const r = new MockResponse('', { status }); r.redirectUrl = url; return r; }
	}
	const caches = {
		async open(name) {
			if (!stores.has(name)) stores.set(name, new Map());
			const store = stores.get(name);
			return {
				async put(req, res) { store.set(typeof req === 'string' ? req : new URL(req.url, 'https://app.example').pathname + '|' + req.url, await res.body); },
				async match(req) { const v = store.get(typeof req === 'string' ? req : new URL(req.url, 'https://app.example').pathname + '|' + req.url); return v === undefined ? undefined : new MockResponse(v); },
				async delete(req) { return store.delete(typeof req === 'string' ? req : new URL(req.url, 'https://app.example').pathname + '|' + req.url); },
				async addAll() {},
			};
		},
		async keys() { return [...stores.keys()]; },
		async delete(name) { return stores.delete(name); },
		async match() { return undefined; },
	};
	const self = {
		location: { origin: 'https://app.example' },
		addEventListener(type, fn) { listeners[type] = fn; },
		skipWaiting() {},
		clients: { async claim() {}, async matchAll() { return []; } },
		registration: { async showNotification() {} },
	};
	const sandbox = {
		self, caches, Request: MockRequest, Response: MockResponse,
		URL, console, btoa, setTimeout, clearTimeout,
		fetch: async () => new MockResponse('network'),
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(swSource, sandbox);
	return { listeners, stores, sandbox };
}
function evt(extra = {}) {
	const e = { ...extra };
	e.waitUntil = (p) => { e._p = p; };
	e.respondWith = (p) => { e._r = p; };
	return e;
}

console.log('=== test-share-sw: TTL helper (pure semantics via vm global) ===');
{
	const { sandbox } = makeEnv();
	const now = 1800000000000;
	check('fresh payload passes', sandbox.isSharePayloadFresh({ ts: now - 1000 }, now) === true);
	check('payload at exactly TTL passes', sandbox.isSharePayloadFresh({ ts: now - 5 * 60 * 1000 }, now) === true);
	check('payload past TTL rejected', sandbox.isSharePayloadFresh({ ts: now - 5 * 60 * 1000 - 1 }, now) === false);
	check('missing ts rejected', sandbox.isSharePayloadFresh({}, now) === false);
	check('string ts rejected', sandbox.isSharePayloadFresh({ ts: String(now) }, now) === false);
	check('NaN ts rejected', sandbox.isSharePayloadFresh({ ts: NaN }, now) === false);
	check('far-future ts rejected', sandbox.isSharePayloadFresh({ ts: now + 60000 }, now) === false);
}

console.log('=== test-share-sw: share POST stores payload with ts ===');
{
	const { listeners, stores } = makeEnv();
	const form = {
		get(k) { return { title: 'T', text: 'hello share', url: 'https://x.example' }[k] || null; },
		getAll() { return []; },
	};
	const req = { method: 'POST', url: 'https://app.example/share-target', formData: async () => form };
	const e = evt({ request: req });
	listeners.fetch(e);
	const res = await e._r;
	check('share POST redirects to ?share=1', !!res && String(res.redirectUrl || '').includes('share=1'));
	const store = stores.get('jmlt-share-v1');
	check('share cache created', !!store && store.size === 1);
	const body = store ? [...store.values()][0] : '';
	const payload = JSON.parse(body);
	check('stored payload embeds numeric ts close to now', typeof payload.ts === 'number' && Math.abs(Date.now() - payload.ts) < 10000);
	check('stored payload carries text', payload.text === 'hello share');
}

console.log('=== test-share-sw: oversize file honestly dropped ===');
{
	const { listeners, stores } = makeEnv();
	const big = { name: 'big.bin', type: 'application/octet-stream', size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(8) };
	const form = { get() { return null; }, getAll() { return [big]; } };
	const req = { method: 'POST', url: 'https://app.example/share-target', formData: async () => form };
	const e = evt({ request: req });
	listeners.fetch(e);
	await e._r;
	const payload = JSON.parse([...stores.get('jmlt-share-v1').values()][0]);
	check('file over 5MB is dropped, payload still stored', Array.isArray(payload.files) && payload.files.length === 0);
}

console.log('=== test-share-sw: activate deletes share cache ===');
{
	const { listeners, stores } = makeEnv();
	stores.set('jmlt-share-v1', new Map([['k', 'stale']]));
	stores.set('jmlt-pwa-v2-shell', new Map());
	const e = evt();
	listeners.activate(e);
	await e._p;
	check('activate removes jmlt-share-v1', !stores.has('jmlt-share-v1'));
	check('activate keeps current shell cache', stores.has('jmlt-pwa-v2-shell'));
}

console.log('=== test-share-sw: non-share requests untouched ===');
{
	const { listeners, stores } = makeEnv();
	const e = evt({ request: { method: 'POST', url: 'https://other.example/share-target', formData: async () => ({ get: () => null, getAll: () => [] }) } });
	listeners.fetch(e);
	check('cross-origin share POST is not intercepted', e._r === undefined && !stores.has('jmlt-share-v1'));
}

console.log('=== test-share-sw: page-side contract (static) ===');
check('main.js checks payload.ts against 5-minute TTL after take', /payload\.ts/.test(mainSource) && /5 \* 60 \* 1000/.test(mainSource));
check('main.js still deletes the entry before parsing', mainSource.indexOf("cache.delete('./__share-payload')") < mainSource.indexOf('hit.json()'));
check('sw.js no longer claims in-memory-only storage', !swSource.includes('只进内存里的 Cache 条目'));

console.log(`\ntest-share-sw: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

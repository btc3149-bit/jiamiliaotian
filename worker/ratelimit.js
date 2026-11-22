// S-1/S-2 rate-limit constants and pure decision functions (PR-4).
// 限流常量与纯函数判定（PR-4）。无平台依赖，可在 Node 里直接单测；
// server/server.js 内有同语义实现一份，两边常量必须同步（注释互指）。
//
// Derivations (see 执行方案 §3 限值总表, owner-approved defaults):
// - Legal peak: file volumes are sent at 50 frames/s (client/js/util.file.js
//   batches of 5 every 100ms) → refill 60/s = 1.2x headroom; bucket 120
//   ≈ 2.4s of full-rate burst, so honest file sends never trip it.
// - Byte window: 350MB per rolling 10 minutes of inbound per connection.
// - Fanout 64: the 8MB frame cap already bounds file frames to ~16 members;
//   64 caps text-frame fanout at 1.28x the 50-person team tier.
// - Channel members 200 = highest team tier in the deployment guide.
// - Handshakes: a legal client handshakes exactly once per connection.

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const RATE_BUCKET_CAPACITY = 120;
export const RATE_REFILL_PER_SEC = 60;
export const RATE_MAX_VIOLATIONS = 3;
export const BYTE_WINDOW_MS = 10 * 60 * 1000;
export const BYTE_WINDOW_MAX = 350 * 1024 * 1024;
export const MAX_FANOUT = 64;
export const MAX_CHANNEL_MEMBERS = 200;
export const MAX_CONNECTIONS_PER_DO = 256;
export const MAX_CONNECTIONS_GLOBAL = 1000;
export const MAX_CONNECTIONS_PER_IP = 100;
export const MAX_HANDSHAKES_PER_CONNECTION = 3;
export const MAX_HANDSHAKES_PER_IP = 10;
export const HANDSHAKE_WINDOW_MS = 60 * 1000;
export const IP_MAP_MAX_ENTRIES = 10000;

// A legal handshake frame is exactly the hex of an uncompressed P-384
// public key: 194 chars, first byte 04. Anything else is rejected before
// any cryptographic work happens (S-2).
export const HANDSHAKE_FRAME_RE = /^04[0-9a-fA-F]{192}$/;
export function isHandshakeFrame(message) {
	return typeof message === 'string' && HANDSHAKE_FRAME_RE.test(message);
}

// ---- token bucket (per connection) ----
export function createBucket(now) {
	return { tokens: RATE_BUCKET_CAPACITY, last: now, violations: 0 };
}
// Returns { allow, shouldClose }. On deny the frame is dropped and the
// violation counted; at RATE_MAX_VIOLATIONS the caller closes (1008).
export function bucketAllow(state, now) {
	const elapsedSec = Math.max(0, (now - state.last) / 1000);
	state.tokens = Math.min(RATE_BUCKET_CAPACITY, state.tokens + elapsedSec * RATE_REFILL_PER_SEC);
	state.last = now;
	if (state.tokens >= 1) {
		state.tokens -= 1;
		return { allow: true, shouldClose: false };
	}
	state.violations += 1;
	return { allow: false, shouldClose: state.violations >= RATE_MAX_VIOLATIONS };
}

// ---- rolling byte window (per connection) ----
export function createByteWindow(now) {
	return { start: now, bytes: 0 };
}
export function byteWindowAllow(state, length, now) {
	if (now - state.start > BYTE_WINDOW_MS) {
		state.start = now;
		state.bytes = 0;
	}
	state.bytes += length;
	return state.bytes <= BYTE_WINDOW_MAX;
}

// ---- per-IP handshake attempt window (Map<ip, {count, resetAt}>) ----
export function ipHandshakeAllow(map, ip, now) {
	if (map.size > IP_MAP_MAX_ENTRIES) {
		for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
		if (map.size > IP_MAP_MAX_ENTRIES) map.clear();
	}
	let rec = map.get(ip);
	if (!rec || rec.resetAt <= now) {
		rec = { count: 0, resetAt: now + HANDSHAKE_WINDOW_MS };
		map.set(ip, rec);
	}
	rec.count += 1;
	return rec.count <= MAX_HANDSHAKES_PER_IP;
}
export function ipHandshakeCount(map, ip, now) {
	const rec = map.get(ip);
	if (!rec || rec.resetAt <= now) return 0;
	return rec.count;
}

// ==================== v1.6.0 #15: Symmetric ratchet (simplified, per-peer) ====================
// v1.6.0 #15：对称 ratchet（简化版，逐对端）。
//
// SECURITY / RULES.md 对照：
// - 密钥链：根密钥 = 既有每连接每对端 ECDH⊕口令 的 shared；每条消息一个
//   消息密钥（HMAC 链推进），用后即焚 → 会话内前向保密（拿到当前链密钥
//   推不出已删除的历史消息密钥）。
// - 双向链域分离：send/recv 链从根分别派生（"…:send" / "…:recv"），双方
//   并发发送不会撞链。
// - 代（generation）机制：重连 = 新 ECDH = 新根 = 新代；会话中 rekey（'rk'/
//   'rka' 握手，由公钥字典序较小的一方发起）产生新根新代。接收端保留
//   activeGen-1 的接收态以跨过渡窗口。
// - 乱序与丢包：跳过键缓冲（skipped keys），上限默认 200 条，超出先丢最
//   小下标——键缓冲有界（不变量 4 精神：内存最小化）。
// - 重放防护：按序消息密钥用后即删，同一条线格式重放解不开（ ci 已消费）。
// - 巨幅跳变防 DoS：ci 相对 recvIndex 超过缓冲上限直接拒绝，不做百万级
//   链推进。
// - 状态仅存内存（this.ratchets），绝不落盘——RULES 第 3 条扩展执行。
// - 零新依赖：HMAC-SHA256 手工实现（js-sha256 已审），ChaCha20-Poly1305
//   沿用 @stablelib。
//
// 线格式：`KV2|<gen>|<ci>|<iv-b64>|<ct-b64>`（外层信封版本号，老客户端
// 解不开即丢弃；载荷 JSON 形状与 legacy 完全一致）。

import { sha256 } from 'js-sha256';
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import { Buffer } from 'buffer';

export const RATCHET_WIRE_PREFIX = 'KV2';
export const DEFAULT_SKIPPED_CAP = 200;
export const DEFAULT_REKEY_EVERY = 500;
// Beyond this gap we refuse to advance at all (absurd = attack; advancing
// would burn CPU). Within the gap we always advance — liveness beats
// completeness: messages beyond the skipped cap are lost, the chain lives on.
// 超过此间隙直接拒绝（荒谬=攻击，推进只是烧 CPU）。间隙内永远推进——
// 活性优先于完整性：超出的消息永久丢失，但链继续活着。
export const RATCHET_MAX_GAP = 65536;

function utf8(s) {
	return Buffer.from(String(s), 'utf8');
}

// ---- HMAC-SHA256 (RFC 2104), pure & sync (js-sha256 base) ----
export function hmacSha256(key, msg) {
	const BLOCK = 64;
	let k = (key instanceof Uint8Array) ? key : new Uint8Array(key);
	if (k.length > BLOCK) k = new Uint8Array(sha256.array(Array.from(k)));
	const kp = new Uint8Array(BLOCK);
	kp.set(k);
	const ipad = new Uint8Array(BLOCK);
	const opad = new Uint8Array(BLOCK);
	for (let i = 0; i < BLOCK; i++) {
		ipad[i] = kp[i] ^ 0x36;
		opad[i] = kp[i] ^ 0x5c;
	}
	const inner = sha256.array(Array.from(ipad).concat(Array.from(msg)));
	return new Uint8Array(sha256.array(Array.from(opad).concat(inner)));
}

// ---- hash-ratchet primitives (domain-separated) ----
export function chainStep(chainKey) {
	return hmacSha256(chainKey, utf8('jmlt-ratchet:step'));
}
export function messageKeyFrom(chainKey) {
	return hmacSha256(chainKey, utf8('jmlt-ratchet:msg'));
}
// Direction chains are anchored to a ROLE, not to a direction label: both
// peers derive chainA/chainB from the root; the peer whose Curve25519 public
// key sorts first uses chainA to send (and chainB to receive), the other one
// swaps. That way sender.send === receiver.recv while keeping the two
// directions independent (concurrent sends never share a chain).
// 方向链锚定在「角色」上：双方各自派生 chainA/chainB，公钥字典序较小的一
// 方用 A 发送、B 接收，另一方对调。这样 发送方的 send 链 === 接收方的
// recv 链，且两个方向永不共链（并发发送互不干扰）。
export function directionKeysFrom(rootKey, isFirst) {
	const a = hmacSha256(rootKey, utf8('jmlt-ratchet:v2:chainA'));
	const b = hmacSha256(rootKey, utf8('jmlt-ratchet:v2:chainB'));
	return isFirst
		? { send: a, recv: b }
		: { send: b, recv: a };
}

// Which content actions participate in the ratchet: message content ('m',
// except file-transfer volumes) and sync-replay batches ('rs'). Metadata
// actions (typing/receipts/reactions/presence/call signals) and file volumes
// stay on the legacy session key — documented honestly.
// 参与 ratchet 的内容动作：'m'（文件分卷除外）与 'rs'（重播批次）。
// 元数据类与文件分卷暂留 legacy 会话密钥——诚实边界已写入 Release。
export function isRatchetEligible(payloadObj) {
	if (!payloadObj || typeof payloadObj !== 'object') return false;
	if (payloadObj.a === 'rs') return true;
	if (payloadObj.a === 'm') {
		return (typeof payloadObj.t === 'string') && !payloadObj.t.startsWith('file');
	}
	return false;
}

// ---- one generation: both directional chains ----
export class RatchetGeneration {
	constructor(rootKey, isFirst) {
		const dirs = directionKeysFrom(rootKey, isFirst === true);
		this.sendKey = dirs.send;
		this.recvKey = dirs.recv;
		this.sendIndex = 0;
		this.recvIndex = 0;
		this.skipped = new Map(); // ci -> message key (Uint8Array)
	}

	// Derive the next send message key and advance. The derived key is
	// returned once and never stored — forward secrecy by construction.
	// 派生下一条发送消息密钥并推进。密钥只返回一次、绝不存储。
	nextSendKey() {
		const mk = messageKeyFrom(this.sendKey);
		const ci = this.sendIndex;
		this.sendKey = chainStep(this.sendKey);
		this.sendIndex++;
		return { mk, ci };
	}

	// Get the receive message key for chain index `ci`. In-order → derive and
	// advance; ahead → advance unconditionally (buffering at most skippedCap
	// keys — beyond the cap messages are lost but the chain stays alive);
	// behind → skipped store. Never let a huge gap wedge the chain.
	// 取接收方向 ci 的消息密钥。按序→派生推进；超前→无条件推进（至多缓冲
	// skippedCap 条——超出的消息丢弃但链保持活性）；落后→查跳过键表。
	recvKeyFor(ci, skippedCap = DEFAULT_SKIPPED_CAP) {
		if (!Number.isInteger(ci) || ci < 0) return null;
		if (ci < this.recvIndex) return null; // consumed already (or evicted)
		if (ci - this.recvIndex > RATCHET_MAX_GAP) return null; // absurd gap
		while (this.recvIndex < ci) {
			const mk = messageKeyFrom(this.recvKey);
			this.skipped.set(this.recvIndex, mk);
			this.recvKey = chainStep(this.recvKey);
			this.recvIndex++;
		}
		// ci === recvIndex
		const mk = messageKeyFrom(this.recvKey);
		this.recvKey = chainStep(this.recvKey);
		this.recvIndex++;
		this.enforceSkippedCap(skippedCap);
		return mk;
	}

	// Consume a stored skipped key (one-shot). 消费一条跳过键（一次性）。
	takeSkipped(ci) {
		const mk = this.skipped.get(ci);
		if (mk) this.skipped.delete(ci);
		return mk || null;
	}

	skippedCount() {
		return this.skipped.size;
	}

	// Bound the skipped-key store: evict the LOWEST indices first (oldest
	// messages are the least likely to arrive and the least valuable).
	// 跳过键上限：先逐出最小下标（最老的消息最难再到达、价值最低）。
	enforceSkippedCap(cap = DEFAULT_SKIPPED_CAP) {
		while (this.skipped.size > cap) {
			let min = Infinity;
			for (const k of this.skipped.keys()) if (k < min) min = k;
			this.skipped.delete(min);
		}
	}
}

// ---- per-peer ratchet manager: generations + rekey bookkeeping ----
export class PeerRatchet {
	constructor({ rootKey, isFirst = false, canInitiateRekey = false, skippedCap = DEFAULT_SKIPPED_CAP, rekeyEvery = DEFAULT_REKEY_EVERY } = {}) {
		if (!(rootKey instanceof Uint8Array) || rootKey.length !== 32) {
			throw new Error('PeerRatchet: rootKey must be 32 bytes');
		}
		this.skippedCap = skippedCap;
		this.rekeyEvery = rekeyEvery;
		this.isFirst = isFirst === true;
		this.canInitiateRekey = canInitiateRekey === true;
		this.gens = new Map();   // gen -> RatchetGeneration
		this.activeGen = 1;      // SEND side generation (recv accepts any seeded)
		this._sendsInGen = 0;
		this._rekeyRequested = 0; // gen the local side wants to initiate
		this.gens.set(1, new RatchetGeneration(rootKey, this.isFirst));
	}

	// Store a future generation's root (from the rekey handshake). Only the
	// next generation is accepted — no skipped generations, no overwrites.
	// 存储未来代的根（来自 rekey 握手）。只收紧邻下一代——不许跳代、不许覆盖。
	seedRoot(gen, rootKey) {
		if (!Number.isInteger(gen) || gen !== this.activeGen + 1) return false;
		if (!(rootKey instanceof Uint8Array) || rootKey.length !== 32) return false;
		if (this.gens.has(gen)) return false;
		this.gens.set(gen, new RatchetGeneration(rootKey, this.isFirst));
		return true;
	}

	hasRoot(gen) {
		return this.gens.has(gen);
	}

	// Switch the SEND side to a newer generation (after our 'rk' was acked,
	// or — receiver side — immediately after seeding from an offer).
	// 把发送侧切到新代（我方 'rk' 被确认后；或接收方 seed 后立即切换）。
	activateGen(gen) {
		if (!Number.isInteger(gen) || !this.gens.has(gen)) return false;
		if (gen <= this.activeGen) return false;
		this.activeGen = gen;
		this._sendsInGen = 0;
		this._rekeyRequested = 0;
		this._prune();
		return true;
	}

	activeGeneration() {
		return this.activeGen;
	}

	_prune() {
		// keep the active generation and the previous one (transition window)
		// 保留当前代与上一代（过渡窗口）
		for (const g of Array.from(this.gens.keys())) {
			if (g < this.activeGen - 1) this.gens.delete(g);
		}
	}

	encryptOutgoing(payloadObj) {
		const genState = this.gens.get(this.activeGen);
		if (!genState) return null;
		let json;
		try {
			json = Buffer.from(JSON.stringify(payloadObj), 'utf8');
		} catch (_e) {
			return null;
		}
		const { mk, ci } = genState.nextSendKey();
		this._sendsInGen++;
		if (this.canInitiateRekey && this._rekeyRequested === 0 &&
			this.rekeyEvery > 0 && this._sendsInGen >= this.rekeyEvery) {
			this._rekeyRequested = this.activeGen + 1;
		}
		try {
			const iv = new Uint8Array(12);
			crypto.getRandomValues(iv);
			const sealed = new ChaCha20Poly1305(mk).seal(iv, json);
			return RATCHET_WIRE_PREFIX + '|' + this.activeGen + '|' + ci + '|' +
				Buffer.from(iv).toString('base64') + '|' + Buffer.from(sealed).toString('base64');
		} catch (_e) {
			return null;
		}
	}

	decryptIncoming(wire) {
		if (typeof wire !== 'string') return null;
		const parts = wire.split('|');
		if (parts.length !== 5 || parts[0] !== RATCHET_WIRE_PREFIX) return null;
		const gen = Number(parts[1]);
		const ci = Number(parts[2]);
		if (!Number.isInteger(gen) || !Number.isInteger(ci) || gen < 1 || ci < 0) return null;
		const genState = this.gens.get(gen);
		if (!genState) return null; // unknown/future generation (offer not arrived)
		let mk;
		if (ci >= genState.recvIndex) {
			mk = genState.recvKeyFor(ci, this.skippedCap);
		} else {
			mk = genState.takeSkipped(ci); // replayed/out-of-order old message
		}
		if (!mk) return null; // consumed, evicted, or gap too large
		let plain;
		try {
			plain = new ChaCha20Poly1305(mk).open(
				new Uint8Array(Buffer.from(parts[3], 'base64')),
				new Uint8Array(Buffer.from(parts[4], 'base64')));
		} catch (_e) {
			return null;
		}
		if (!plain) return null; // AEAD auth failure (tamper)
		try {
			return JSON.parse(Buffer.from(plain).toString('utf8'));
		} catch (_e) {
			return null;
		}
	}

	// One-shot rekey trigger check (set during encryptOutgoing).
	// 一次性 rekey 触发检查（encryptOutgoing 期间置位）。
	shouldRekey() {
		return this._rekeyRequested !== 0;
	}

	consumeRekeyGen() {
		const g = this._rekeyRequested;
		this._rekeyRequested = 0;
		return g || null;
	}

	stats() {
		const g = this.gens.get(this.activeGen);
		return {
			activeGen: this.activeGen,
			generations: Array.from(this.gens.keys()),
			sendIndex: g ? g.sendIndex : 0,
			recvIndex: g ? g.recvIndex : 0,
			skipped: g ? g.skippedCount() : 0
		};
	}
}

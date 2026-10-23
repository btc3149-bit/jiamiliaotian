// v1.3.0 #6: local-only room metadata (alias / group / pinned).
// SECURITY / RULES.md 对照：
// - 全部本地视图：localStorage `jmlt_room_meta_<hash>`，房间哈希与凭据不动
// - 重命名只改显示名——房间身份 = 密码+哈希，改名不改任何安全属性（文档已注明）
// - alias/group 存储前限长 + 转义责任在渲染方（与 roomName 同等待遇）
// - 纯函数可在 Node 单测

import { sha256 } from 'js-sha256';

export function roomHashOf(roomName) {
	return sha256(String(roomName || ''))
}

// Pure: sanitize a meta patch before persisting.
// 纯函数：持久化前清洗 meta 补丁。
export function sanitizeRoomMeta(meta) {
	const out = {};
	if (!meta || typeof meta !== 'object') return out;
	if (typeof meta.alias === 'string') out.alias = meta.alias.trim().slice(0, 64);
	if (typeof meta.group === 'string') out.group = meta.group.trim().slice(0, 32);
	if (typeof meta.pinned === 'boolean') out.pinned = meta.pinned;
	return out
}

export function getRoomMeta(hash) {
	try {
		const raw = localStorage.getItem('jmlt_room_meta_' + hash);
		return raw ? sanitizeRoomMeta(JSON.parse(raw)) : {}
	} catch (_e) {
		return {}
	}
}

export function setRoomMeta(hash, patch) {
	try {
		const next = { ...getRoomMeta(hash), ...sanitizeRoomMeta(patch) };
		// drop empty keys so the storage stays minimal
		for (const k of Object.keys(next)) {
			if (next[k] === '' || next[k] === false) delete next[k]
		}
		if (Object.keys(next).length === 0) localStorage.removeItem('jmlt_room_meta_' + hash);
		else localStorage.setItem('jmlt_room_meta_' + hash, JSON.stringify(next));
		return next
	} catch (_e) {
		return {}
	}
}

// Pure: display name resolution — alias overrides the raw room name.
// 纯函数：显示名解析——alias 覆盖原始房间名。
export function displayRoomName(roomName, meta) {
	if (meta && typeof meta.alias === 'string' && meta.alias) return meta.alias;
	return String(roomName || '')
}

// Pure: sort room indexes — pinned first (stable within groups); everything
// else keeps its natural order. Returns a permutation of the input indexes.
// 纯函数：排序房间下标——置顶优先（组内稳定），其余保持原顺序。返回下标排列。
export function sortRoomIndexes(indexes, metaOf) {
	if (!Array.isArray(indexes)) return [];
	const pinned = indexes.filter((i) => {
		const m = metaOf(i);
		return m && m.pinned === true
	});
	const rest = indexes.filter((i) => pinned.indexOf(i) === -1);
	return pinned.concat(rest)
}

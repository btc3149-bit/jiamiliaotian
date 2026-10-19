// v1.2.0 #11: offline send queue — memory-only, per-room, flushed on reconnect.
// SECURITY / RULES.md 对照：
// - 队列只存**闭包 + 已捕获的明文内容**，仅存内存（不进 localStorage/
//   IndexedDB）——刷新即失，遵循诚实告知原则（与断线补拉同一设计哲学：
//   服务器零持久化，客户端也不悄悄把明文落盘）
// - 私聊消息不入队：clientId 是会话级标识，重连后目标可能已变，入队必然
//   错投；离线私聊直接走现有失败提示
// - flush 在 onServerSecured（E2EE server-shared 就绪）之后触发

import { t } from './util.i18n.js';

// Room is fully ready to accept sends: ws open + server-shared key derived.
// 房间可发送：ws 已开 + server-shared 密钥已就绪。
export function isRoomConnected(rd) {
	return !!(rd && rd.chat && rd.chat.connection &&
		rd.chat.connection.readyState === 1 && rd.chat.serverShared)
}

// Queue a send closure. Memory-only by design (see header).
// 入队一个发送闭包。仅内存（见文件头说明）。
export function enqueueSend(rd, fn) {
	if (!rd) return false;
	if (!Array.isArray(rd.sendQueue)) rd.sendQueue = [];
	rd.sendQueue.push(fn);
	return true
}

export function queueLength(rd) {
	return rd && Array.isArray(rd.sendQueue) ? rd.sendQueue.length : 0
}

// Pure helper (unit-testable): given per-item outcomes, decide the final
// queue content. Failed items are re-queued in front (preserve order).
// 纯函数（可单测）：根据逐项结果决定最终队列内容，失败项放回队首保序。
export function mergeFlushResults(queued, failed) {
	return failed.concat(queued)
}

// Try to flush the room's queue. Called from onServerSecured /
// handleClientList. Failures (e.g. sendChannelMessage throw) are re-queued.
// 尝试冲刷房间队列。失败项重新入队。
export function flushSendQueue(rd) {
	if (!rd || !Array.isArray(rd.sendQueue) || rd.sendQueue.length === 0) return 0;
	if (!isRoomConnected(rd)) return 0;
	if (rd._flushing) return 0;
	rd._flushing = true;
	const batch = rd.sendQueue.splice(0, rd.sendQueue.length);
	const failed = [];
	let sent = 0;
	for (const fn of batch) {
		try {
			fn();
			sent++
		} catch (_e) {
			failed.push(fn)
		}
	}
	rd.sendQueue = mergeFlushResults(rd.sendQueue, failed);
	rd._flushing = false;
	if (sent > 0 && window.addSystemMsg) {
		window.addSystemMsg(t('system.queue_flushed', 'Sent {n} queued message(s) after reconnect.').replace('{n}', String(sent)), true)
	}
	return sent
}

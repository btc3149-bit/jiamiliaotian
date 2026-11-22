// Item 27: message-list DOM windowing (pure logic — no DOM, unit-testable).
// 第 27 条：消息列表 DOM 窗口化（纯逻辑，无 DOM 依赖，可单测）。
//
// Design / 设计：
// - Only the DOM is windowed. rd.messages (the in-memory array) is NEVER
//   trimmed by this layer: it is the data source for peer replay and for
//   local search, so cutting it would silently break both. Rendering is
//   the expensive part (one bubble subtree per message), data is cheap.
//   只裁 DOM、不裁数据：rd.messages 同时是同伴重播与本地搜索的数据源，
//   裁了会静默破坏两者；贵的是每条消息的气泡子树渲染，便宜的是数据本身。
// - Initial render shows the most recent MSG_WINDOW_SIZE messages;
//   scrolling near the top expands the window by MSG_WINDOW_PAGE older
//   messages at a time until the whole loaded history is rendered.
//   首屏只渲染最近 MSG_WINDOW_SIZE 条；上滑接近顶部时按页补更早的。
// - No virtual-scroll library: heights are variable (images/files), a
//   spacer-based virtual list would misplace scroll anchors. Re-rendering
//   a bounded slice keeps every existing behaviour (reactions, burn
//   timers, action bars) on the exact same code path as a full render.
//   不引虚拟滚动库：消息高度不定（图片/文件），占位式虚拟列表会错位
//   滚动锚点；按片重渲染让所有既有行为与全量渲染走同一代码路径。

export const MSG_WINDOW_SIZE = 200;
export const MSG_WINDOW_PAGE = 100;
export const MSG_WINDOW_SCROLL_THRESHOLD = 240;
// Context lines kept above a jump target so it does not land flush at the
// very top of the rendered slice.
// 跳转定位时目标上方保留的上下文条数，避免目标贴在渲染片顶端。
export const MSG_WINDOW_JUMP_CONTEXT = 20;

function saneCount(n) {
	const v = Math.floor(Number(n));
	return Number.isFinite(v) && v > 0 ? v : 0
}

function saneIndex(n) {
	const v = Math.floor(Number(n));
	return Number.isFinite(v) && v > 0 ? v : 0
}

// Start index for the initial render: the last `size` messages.
// 首屏渲染的起始下标：最后 size 条。
export function initialWindowStart(total, size = MSG_WINDOW_SIZE) {
	const t = saneCount(total);
	const s = saneCount(size) || MSG_WINDOW_SIZE;
	return Math.max(0, t - s)
}

// Start index after expanding one page towards older messages.
// 向更早方向扩一页后的起始下标。
export function expandWindowStart(start, page = MSG_WINDOW_PAGE) {
	const p = saneCount(page) || MSG_WINDOW_PAGE;
	return Math.max(0, saneIndex(start) - p)
}

// True while older loaded messages exist above the rendered slice.
// 渲染片上方还有更早的已加载消息时为真。
export function hasEarlierMessages(start) {
	return saneIndex(start) > 0
}

// True when a scroll position should trigger expanding the window.
// 滚动位置是否应触发向上扩窗。
export function shouldExpandWindow(scrollTop, start, threshold = MSG_WINDOW_SCROLL_THRESHOLD) {
	if (!hasEarlierMessages(start)) return false;
	const top = Number(scrollTop);
	if (!Number.isFinite(top)) return false;
	const th = saneCount(threshold) || MSG_WINDOW_SCROLL_THRESHOLD;
	return top <= th
}

// Start index that makes `index` visible with some context above it.
// Never moves the window forward (a later target keeps the current start).
// 让 index 可见且上方留上下文的起始下标；绝不向前移动窗口。
export function windowStartForIndex(index, currentStart, context = MSG_WINDOW_JUMP_CONTEXT) {
	const idx = saneIndex(index);
	const cur = saneIndex(currentStart);
	if (idx >= cur) return cur;
	const ctx = Math.floor(Number(context));
	const safeCtx = Number.isFinite(ctx) && ctx > 0 ? ctx : 0;
	return Math.max(0, Math.min(cur, idx - safeCtx))
}

// Clamp a start index against a (possibly shrunk) array length so a slice
// start never points past the end of the array.
// 数组长度变化后夹紧起始下标，保证切片起点不越过数组末尾。
export function clampWindowStart(start, total) {
	return Math.min(saneIndex(start), saneCount(total))
}

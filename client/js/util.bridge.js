// ==================== Module-level callback registry ====================
// 模块级回调注册表（评审第 48 条）：替代 window.__jmlt* 全局桥。
//
// Why: the settings panel / room / chat modules cannot import the
// renderers or the call manager from main.js without an import cycle, so
// main.js used to publish hooks on window.__jmlt*. A missed registration
// failed silently (callers guarded with `if (window.__jmltX)`), and no
// static check could see the wiring. This registry keeps the same
// late-binding semantics — register from main.js, call from anywhere —
// as explicit module state instead of window globals. Same pattern as
// chat.js setReadReceiptSender (explicit injection), generalized.
//
// 为什么：设置面板/房间/聊天模块直接 import main.js 的渲染器与通话管理器
// 会成环，故 main.js 过去把钩子挂在 window.__jmlt* 上——漏注册只会静默
// 失效、静态检查看不见。这里保持同样的晚绑定语义（main.js 注册、任意
// 模块调用），但状态是模块级的，不再污染 window。

const registry = new Map();

// Register (or replace) the handler for a bridge name. Called by main.js
// during startup. Non-function values are ignored.
export function registerBridge(name, fn) {
	if (typeof name === 'string' && typeof fn === 'function') {
		registry.set(name, fn)
	}
}

// Whether a handler is currently registered for a bridge name.
export function hasBridge(name) {
	return registry.has(name)
}

// Invoke the registered handler, if any. Returns its return value, or
// undefined when nothing is registered (the old `if (window.__jmltX)`
// guard semantics). Exceptions propagate — callers that treated the
// bridge as best-effort keep their own try/catch, exactly as before.
export function callBridge(name, ...args) {
	const fn = registry.get(name);
	if (!fn) return undefined;
	return fn(...args)
}

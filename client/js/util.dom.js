// Query single DOM element
// 查询单个 DOM 元素
export function $(selector, parent = document) {
	return parent.querySelector(selector)
}
// Query multiple DOM elements
// 查询多个 DOM 元素
export function $$(selector, parent = document) {
	return parent.querySelectorAll(selector)
}
// Get element by ID
// 通过 ID 获取元素
export function $id(id) {
	return document.getElementById(id)
}
// Shared attribute application for createElement / createElementHTML
// createElement / createElementHTML 共用的属性设置逻辑
function applyAttrs(el, attrs) {
	Object.entries(attrs).forEach(([key, value]) => {
		if (key === 'class' || key === 'className') {
			el.className = value
		} else if (key === 'style' && typeof value === 'object') {
			Object.assign(el.style, value)
		} else if (key.startsWith('on') && typeof value === 'function') {
			el.addEventListener(key.slice(2).toLowerCase(), value)
		} else {
			el.setAttribute(key, value)
		}
	});
}
// Create a DOM element with attributes and SAFE text content.
// SECURITY (RULES.md invariant 5): string content is assigned via
// textContent — it is NEVER parsed as HTML. Callers must not pre-escape
// (no escapeHTML needed, and pre-escaped text would show literally).
// Pass a DOM Node (or an array of Nodes/strings) to nest elements.
// 创建带属性和内容的 DOM 元素。安全默认：字符串内容走 textContent，
// 绝不解析为 HTML；调用方不要预先 escapeHTML（会双重转义）。
export function createElement(tag, attrs = {}, content = '') {
	const el = document.createElement(tag);
	applyAttrs(el, attrs);
	if (typeof content === 'string') {
		if (content) el.textContent = content
	} else if (content instanceof Node) {
		el.appendChild(content)
	} else if (Array.isArray(content)) {
		content.forEach((item) => {
			if (typeof item === 'string') {
				if (item) el.appendChild(document.createTextNode(item))
			} else if (item instanceof Node) {
				el.appendChild(item)
			}
		})
	}
	return el
}
// Create a DOM element whose string content IS parsed as HTML.
// Explicit opt-in for call sites that genuinely need markup. Every
// interpolated value in the HTML string must already be escaped
// (escapeHTML) or be a compile-time constant — same audit rule as
// innerHTML. Prefer createElement unless markup is truly required.
// 显式 HTML 版本：仅供确实需要标记结构的调用点。插值必须先 escapeHTML。
export function createElementHTML(tag, attrs = {}, content = '') {
	const el = document.createElement(tag);
	applyAttrs(el, attrs);
	if (typeof content === 'string') {
		el.innerHTML = content
	} else if (content instanceof Node) {
		el.appendChild(content)
	}
	return el
}
// Add event listener
// 添加事件监听器
export function on(target, event, handler, options) {
	const el = typeof target === 'string' ? $(target) : target;
	if (el) el.addEventListener(event, handler, options)
}
// Remove event listener
// 移除事件监听器
export function off(target, event, handler) {
	const el = typeof target === 'string' ? $(target) : target;
	if (el) el.removeEventListener(event, handler)
}
// Add class(es) to element
// 为元素添加类名
export function addClass(el, ...classNames) {
	el.classList.add(...classNames)
}
// Remove class(es) from element
// 移除元素的类名
export function removeClass(el, ...classNames) {
	el.classList.remove(...classNames)
}
// Toggle class on element
// 切换元素的类名
export function toggleClass(el, className, force) {
	el.classList.toggle(className, force)
}
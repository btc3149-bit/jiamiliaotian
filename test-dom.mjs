// Item 39 (2026-11-22 review): createElement safe-by-default tests.
// createElement 默认走 textContent（字符串永不解析为 HTML），
// 只有显式 createElementHTML 才解析标记。强化 RULES.md 不变量 5。
//
// Node has no DOM and the repo is zero-dependency for tests, so a
// minimal stub models exactly the semantics under test: textContent
// stores a single text node; the innerHTML setter "parses" tags into
// element child nodes (flat, tag-level — enough to prove whether a
// string was parsed as markup or kept as text).
import { readFileSync } from 'fs';

class StubNode {}
class StubText extends StubNode {
	constructor(text) { super(); this.nodeType = 3; this.textContent = text }
}
class StubElement extends StubNode {
	constructor(tag) {
		super();
		this.nodeType = 1;
		this.tagName = String(tag).toUpperCase();
		this.childNodes = [];
		this.className = '';
		this.style = {};
		this.attrs = {};
		this.listeners = {};
		this._innerHTML = null;
	}
	setAttribute(k, v) { this.attrs[k] = String(v) }
	addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
	appendChild(node) { this.childNodes.push(node); return node }
	set textContent(v) {
		this._innerHTML = null;
		this.childNodes = v ? [new StubText(String(v))] : [];
	}
	get textContent() { return this.childNodes.map(c => c.textContent || '').join('') }
	set innerHTML(v) {
		this._innerHTML = String(v);
		this.childNodes = [];
		const re = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
		let m;
		while ((m = re.exec(this._innerHTML))) this.childNodes.push(new StubElement(m[1]));
	}
	get innerHTML() { return this._innerHTML === null ? '' : this._innerHTML }
	get elementChildren() { return this.childNodes.filter(c => c.nodeType === 1) }
}

globalThis.Node = StubNode;
globalThis.Element = StubElement;
globalThis.document = {
	createElement: (tag) => new StubElement(tag),
	createTextNode: (text) => new StubText(text)
};

const { createElement, createElementHTML } = await import('./client/js/util.dom.js');

let passed = 0, failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name) }
	else { failed++; console.log('  ✗ FAIL: ' + name) }
}

console.log('=== test-dom: createElement safe default ===');
const PAYLOAD = '<img src=x onerror=alert(1)>';
const el = createElement('div', {}, PAYLOAD);
check('default: payload yields zero element children', el.elementChildren.length === 0);
check('default: payload yields exactly one text node', el.childNodes.length === 1 && el.childNodes[0].nodeType === 3);
check('default: text preserved literally', el.textContent === PAYLOAD);
check('default: innerHTML never assigned', el.innerHTML === '');
const el2 = createElement('span', {}, 'a & b < c');
check('default: & and < stay literal text', el2.textContent === 'a & b < c' && el2.elementChildren.length === 0);
const el3 = createElement('div', { class: 'box', 'data-mid': 'abc123', onclick: () => {} });
check('default: attrs still applied (class/data-*/handler)', el3.className === 'box' && el3.attrs['data-mid'] === 'abc123' && (el3.listeners.click || []).length === 1);
check('default: empty content → no children', createElement('div', {}).childNodes.length === 0);
const child = createElement('b', {}, 'hi');
const parent = createElement('div', {}, child);
check('default: Node content appended as element', parent.elementChildren.length === 1 && parent.elementChildren[0].tagName === 'B');
const mixed = createElement('div', {}, ['a', child]);
check('default: array content mixes text + nodes safely', mixed.childNodes.length === 2 && mixed.childNodes[0].nodeType === 3 && mixed.elementChildren.length === 1);

console.log('=== test-dom: createElementHTML explicit opt-in ===');
const html = createElementHTML('div', {}, '<span class="x">hi</span>');
check('html: markup parsed into element children', html.elementChildren.length === 1 && html.elementChildren[0].tagName === 'SPAN');
const htmlImg = createElementHTML('div', {}, PAYLOAD);
check('html: same payload DOES create an <img> element (opt-in only)', htmlImg.elementChildren.length === 1 && htmlImg.elementChildren[0].tagName === 'IMG');
const htmlNode = createElementHTML('div', {}, child);
check('html: Node content still appended', htmlNode.elementChildren.length === 1);

console.log('=== test-dom: source lock ===');
const src = readFileSync('./client/js/util.dom.js', 'utf8');
const idx = src.indexOf('export function createElementHTML');
check('source: createElementHTML is exported', idx > 0);
check('source: no innerHTML assignment before createElementHTML (default path is clean)', idx > 0 && !/\.innerHTML\s*=/.test(src.slice(0, idx)));
check('source: createElement assigns textContent', src.slice(0, idx).includes('el.textContent = content'));
for (const f of ['client/js/chat.js', 'client/js/util.fileUpload.js']) {
	const s = readFileSync('./' + f, 'utf8');
	check(`source: ${f} imports createElementHTML for its markup call sites`, s.includes('createElementHTML'));
}

console.log(`\ntest-dom: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// v1.3.0 #8: markdown tokenizer/renderer tests — XSS vectors first-class.
// Node-runnable: util.markdown.js has zero imports.
import {
	tokenizeMarkdown,
	renderMarkdownTokens,
	markdownToHtml,
	isSafeLinkUrl
} from './client/js/util.markdown.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log('  ✓ ' + name) }
	else { failed++; console.log('  ✗ FAIL: ' + name) }
}

console.log('=== test-markdown: tokenizer ===');
check('plain text stays text', JSON.stringify(tokenizeMarkdown('hello world')) === JSON.stringify([{ t: 'text', x: 'hello world' }]));
check('bold token', tokenizeMarkdown('a **b** c').some(t => t.t === 'bold' && t.x === 'b'));
check('italic token', tokenizeMarkdown('*i*').some(t => t.t === 'italic' && t.x === 'i'));
check('inline code token', tokenizeMarkdown('`x=1`').some(t => t.t === 'code' && t.x === 'x=1'));
check('codeblock token', tokenizeMarkdown('```js\nconsole.log(1)\n```').some(t => t.t === 'codeblock' && t.x === 'console.log(1)'));
check('codeblock language tag stripped', tokenizeMarkdown('```js\nlet a\n```')[0].x === 'let a');
check('unclosed ** stays literal', tokenizeMarkdown('a ** b')[0].x === 'a ** b');
check('lone * stays literal', tokenizeMarkdown('a * b')[0].x === 'a * b');
check('bold tolerates nested italics', tokenizeMarkdown('**a *b* c**').some(t => t.t === 'bold' && t.x === 'a *b* c'));
check('empty input → no tokens', tokenizeMarkdown('').length === 0 && tokenizeMarkdown(null).length === 0);

console.log('=== test-markdown: XSS vectors (the whole point) ===');
const xss = [
	'<img src=x onerror=alert(1)>',
	'<script>alert(1)</script>',
	'`<img src=x onerror=alert(1)>`',
	'**<img onerror=alert(1)>**',
	'```<script>alert(1)</script>```',
	'<a href="javascript:alert(1)">x</a>',
	'"><script>alert(1)</script>',
	"'';!--\"<XSS>=&{()}",
	'<svg onload=alert(1)>',
	'<iframe src=javascript:alert(1)>',
	'<body onload=alert(1)>',
	'<input onfocus=alert(1) autofocus>'
];
let allEscaped = true;
for (const v of xss) {
	const html = markdownToHtml(v);
	// a real injection would produce a literal tag or a real event-handler
	// attribute; escaped output shows &lt;tag with the payload as plain text
	if (/<(script|img|iframe|svg|body|input)\b/i.test(html) || /<[a-z][^>]*\son\w+\s*=/i.test(html)) {
		allEscaped = false;
		console.log('    leaked:', v, '=>', html)
	}
}
check('all XSS vectors fully escaped', allEscaped);
check('javascript: URL never becomes a link', markdownToHtml('javascript:alert(1)').indexOf('<a ') === -1);
check('data: URL never becomes a link', markdownToHtml('data:text/html;base64,xxx').indexOf('<a ') === -1);
check('odd scheme is plain text', isSafeLinkUrl('jav\tascript:alert(1)') === false);
check('vbscript: is plain text', isSafeLinkUrl('vbscript:msgbox(1)') === false);

console.log('=== test-markdown: links ===');
const linkHtml = markdownToHtml('see https://example.com/a?b=1 now');
check('https link wrapped', linkHtml.indexOf('<a href="https://example.com/a?b=1"') !== -1);
check('link has noopener noreferrer + _blank', linkHtml.indexOf('target="_blank" rel="noopener noreferrer"') !== -1);
check('link text escaped', markdownToHtml('https://example.com/"onmouseover="x').indexOf('"onmouseover') === -1);

console.log('=== test-markdown: rendering ===');
check('bold wraps in <strong>', markdownToHtml('**hi**') === '<strong>hi</strong>');
check('italic wraps in <em>', markdownToHtml('*hi*') === '<em>hi</em>');
check('code wraps in <code class="md-code">', markdownToHtml('`x`') === '<code class="md-code">x</code>');
check('codeblock wraps in pre.md-codeblock', markdownToHtml('```\na\nb```').indexOf('<pre class="md-codeblock"><code>a\nb</code></pre>') !== -1);
check('newline becomes <br> in text', markdownToHtml('a\nb') === 'a<br>b');
check('mixed content renders in order', markdownToHtml('a *i* b') === 'a <em>i</em> b');
check('non-string input → empty', markdownToHtml(null) === '' && markdownToHtml(42) === '');

console.log(`\ntest-markdown: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

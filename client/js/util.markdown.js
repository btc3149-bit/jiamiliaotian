// v1.3.0 #8: whitelisted Markdown rendering for chat text messages.
// SECURITY / RULES.md 不变量 5 对照：
// - 白名单极小：**bold** / *italic* / `inline code` / ```code block``` /
//   http(s) 自动链接。不支持标题、引用、图片、HTML。
// - 全部内容先 escapeHTML 再包标签（token→转义→包装），没有任何远控字符串
//   能逃出转义；链接 href 仅接受 http/https，其余一律按纯文本输出。
// - 本模块零依赖（不 import DOMPurify/浏览器 API），纯函数可在 Node 单测。

function esc(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[c]))
}

// Only http/https URLs may become links. Everything else stays plain text.
// 仅 http/https 可以成为链接，其余按纯文本输出。
export function isSafeLinkUrl(url) {
	return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url) && !/[\s"'<>]/.test(url)
}

// Tokenizer. Returns [{t:'text'|'bold'|'italic'|'code'|'codeblock'|'link',
// x: content, href?: url}] in document order. Unmatched markers stay literal
// text (e.g. a lone ** renders as-is).
// 分词器。未闭合的标记按普通文本输出（单个 ** 原样保留）。
export function tokenizeMarkdown(text) {
	const tokens = [];
	if (typeof text !== 'string' || text.length === 0) return tokens;
	// code blocks first: ```...``` (content raw, no inline parsing inside)
	const parts = text.split(/```/);
	for (let p = 0; p < parts.length; p++) {
		if (p % 2 === 1) {
			// inside a code block
			let body = parts[p];
			// optional language tag on the same line as the opening fence
			const nl = body.indexOf('\n');
			if (nl !== -1 && body.slice(0, nl).trim() !== '' && !/\s/.test(body.slice(0, nl).trim())) {
				body = body.slice(nl + 1)
			} else if (nl === 0) {
				body = body.slice(1) // empty language line: drop the leading newline
			}
			if (body) tokens.push({ t: 'codeblock', x: body.replace(/\n$/, '') });
			continue
		}
		tokenizeInline(parts[p], tokens)
	}
	return tokens
}

function tokenizeInline(s, out) {
	if (!s) return;
	// pass 1: **bold** wins over single-* (scan bold pairs first). The bold
	// body tolerates lone asterisks so nested *italics* stay inside bold.
	// bold 优先于单星（先扫 ** 对）。bold 体内允许孤立 *，嵌套 *斜体* 归 bold。
	const BOLD = /\*\*((?:[^*]|\*(?!\*))+?)\*\*/g;
	let last = 0;
	let m;
	while ((m = BOLD.exec(s))) {
		if (m.index > last) tokenizeNonBold(s.slice(last, m.index), out);
		out.push({ t: 'bold', x: m[1] });
		last = BOLD.lastIndex
	}
	if (last < s.length) tokenizeNonBold(s.slice(last), out)
}

function tokenizeNonBold(s, out) {
	if (!s) return;
	// pass 2: *italic*, `code`, links
	const re = /(\*([^*\n]+)\*)|(`([^`\n]+)`)|(https?:\/\/[^\s'"<>]+)/g;
	let last = 0;
	let m;
	while ((m = re.exec(s))) {
		if (m.index > last) out.push({ t: 'text', x: s.slice(last, m.index) });
		if (m[2] !== undefined) out.push({ t: 'italic', x: m[2] });
		else if (m[4] !== undefined) out.push({ t: 'code', x: m[4] });
		else out.push({ t: 'link', x: m[5], href: m[5] });
		last = re.lastIndex
	}
	if (last < s.length) out.push({ t: 'text', x: s.slice(last) })
}

// Render tokens to safe HTML. Newlines inside text → <br>; code blocks keep
// their newlines inside <pre><code>.
// 把分词渲染为安全 HTML。文本内换行→<br>；代码块换行保留在 <pre><code> 内。
export function renderMarkdownTokens(tokens) {
	if (!Array.isArray(tokens)) return '';
	let html = '';
	for (const tok of tokens) {
		if (!tok || typeof tok.x !== 'string') continue;
		switch (tok.t) {
			case 'codeblock':
				html += '<pre class="md-codeblock"><code>' + esc(tok.x) + '</code></pre>';
				break;
			case 'code':
				html += '<code class="md-code">' + esc(tok.x) + '</code>';
				break;
			case 'bold':
				html += '<strong>' + esc(tok.x) + '</strong>';
				break;
			case 'italic':
				html += '<em>' + esc(tok.x) + '</em>';
				break;
			case 'link':
				if (isSafeLinkUrl(tok.href)) {
					html += '<a href="' + esc(tok.href) + '" target="_blank" rel="noopener noreferrer" class="md-link">' + esc(tok.x) + '</a>'
				} else {
					html += esc(tok.x)
				}
				break;
			default:
				html += esc(tok.x).replace(/\n/g, '<br>')
		}
	}
	return html
}

// One-shot helper used by chat.js.
export function markdownToHtml(text) {
	return renderMarkdownTokens(tokenizeMarkdown(text))
}

// Use DOMPurify to safely handle HTML content
// 使用 DOMPurify 安全处理 HTML 内容
import DOMPurify from 'dompurify';

// Escape HTML special characters
// 转义 HTML 特殊字符
export function escapeHTML(str) {
	if (typeof str !== 'string') return '';
	// 使用替换方法确保 HTML 特殊字符被转义，而不是被移除
	// 这样 <java> 会变成 &lt;java&gt; 而不是被删除
	return str.replace(/[&<>"']/g, function(c) {
		return {
			'&': '&amp;',  // & 转为 &amp;
			'<': '&lt;',   // < 转为 &lt;
			'>': '&gt;',   // > 转为 &gt;
			'"': '&quot;', // " 转为 &quot;
			"'": '&#39;'   // ' 转为 &#39;
		}[c];
	});
}

// Positive-whitelist sanitizer for image `src` values rendered from remote
// message content (RULES invariant 5). Replaces the old negative approach
// (escapeHTML + strip the literal "javascript:") at every chat image site.
//
// Sender inventory (what legitimate peers actually produce): the send path
// re-encodes still images via canvas → image/webp (image/png fallback);
// the file pipeline and share hand-off pass through common raster uploads.
// So the whitelist is: data:image/<raster>;base64,<strict base64> only.
// - data:image/svg+xml is REJECTED: SVG is scriptable and must never be
//   rendered straight from a remote peer.
// - http(s):/blob:/javascript:/data:text etc. are REJECTED: chat images are
//   always inline data URLs; anything else is not a shape we produce.
// - Whitespace/control-character smuggling fails the anchored charset.
// Returns '' for anything rejected (callers render a broken-image slot
// rather than an attacker-controlled URL).
// 图片 src 正向白名单（不变量 5）：发送端实际只产出 canvas 重编码的
// webp/png 与常见栅格上传，故只放行 data:image/<栅格>;base64 严格格式；
// svg+xml（可脚本化）、远端 URL、javascript:、空白绕过一律拒，拒则返回 ''。
const IMAGE_SRC_RE = /^data:image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/i;
export const MAX_IMAGE_SRC_LEN = 8 * 1024 * 1024; // aligns with the 8MB image upload cap
export function sanitizeImageSrc(src) {
	if (typeof src !== 'string') return '';
	const s = src.trim();
	if (s.length === 0 || s.length > MAX_IMAGE_SRC_LEN) return '';
	return IMAGE_SRC_RE.test(s) ? s : '';
}

// Convert text to HTML, preserving line breaks
// 将文本转换为 HTML，保留换行符
export function textToHTML(text) {
	if (typeof text !== 'string') return '';
	// 先进行 HTML 转义，然后将换行符替换为 <br> 标签
	// 最后使用 DOMPurify 确保结果是安全的 HTML
	const escaped = escapeHTML(text);
	const withLineBreaks = escaped.replace(/\n/g, '<br>');
	return DOMPurify.sanitize(withLineBreaks, {
		ALLOWED_TAGS: ['br'], // 只允许 <br> 标签
		ALLOWED_ATTR: [],     // 不允许任何属性
	});
}
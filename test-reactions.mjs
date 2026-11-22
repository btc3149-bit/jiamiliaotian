// test-reactions.mjs — product-wiring batch (items 14/18/19/20/21).
// Locks: (a) reaction emoji single-grapheme validation semantics;
// (b) static wiring assertions for lazy loading, PWA install entry,
// mobile safe-area/hit-area fixes and the i18n leak fixes.
import fs from 'node:fs';
import { isValidReactionEmoji, countGraphemes, REACTION_EMOJI_MAX_LENGTH } from './client/js/util.validate.js';

let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ FAIL: ' + name); } }
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

console.log('=== test-reactions: single-grapheme validation ===');
check('plain emoji accepted', isValidReactionEmoji('👍') === true);
check('heart + variation selector is one grapheme', isValidReactionEmoji('❤️') === true && countGraphemes('❤️') === 1);
check('skin-tone variant accepted', isValidReactionEmoji('👍🏽') === true);
check('ZWJ family sequence is one grapheme', isValidReactionEmoji('👨‍👩‍👧‍👦') === true && countGraphemes('👨‍👩‍👧‍👦') === 1);
check('flag pair is one grapheme', isValidReactionEmoji('🇺🇸') === true && countGraphemes('🇺🇸') === 1);
check('keycap sequence is one grapheme', isValidReactionEmoji('1️⃣') === true);
check('two emoji rejected (multi-grapheme)', isValidReactionEmoji('👍👍') === false && countGraphemes('👍👍') === 2);
check('emoji + text rejected', isValidReactionEmoji('👍a') === false);
check('plain text rejected by grapheme count path', countGraphemes('ab') === 2 && isValidReactionEmoji('ab') === false);
check('single plain letter is not a reaction', isValidReactionEmoji('a') === false);
check('empty string rejected', isValidReactionEmoji('') === false);
check('whitespace rejected', isValidReactionEmoji(' 👍') === false && isValidReactionEmoji(' ') === false);
check('markup rejected', isValidReactionEmoji('<script>') === false);
check('non-string rejected', isValidReactionEmoji(null) === false && isValidReactionEmoji(42) === false && isValidReactionEmoji(undefined) === false);
check('overlong multi-emoji rejected', isValidReactionEmoji('👍'.repeat(17)) === false);
const longSingle = '👨' + '‍👨'.repeat(20); // one grapheme, > 32 UTF-16 units
check('single grapheme over length cap rejected', countGraphemes(longSingle) === 1 && longSingle.length > REACTION_EMOJI_MAX_LENGTH && isValidReactionEmoji(longSingle) === false);

console.log('=== test-reactions: item 20 wiring (validation at all three points) ===');
const chat = read('./client/js/chat.js');
const room = read('./client/js/room.js');
const nodecrypt = read('./client/js/NodeCrypt.js');
check('chat.js toggleReactionLocal validates', chat.includes('isValidReactionEmoji(emoji)'));
check('chat.js reaction picker reuses full emoji picker', chat.includes('createFullEmojiPicker') && chat.includes('reaction-more'));
check('room.js receive path validates', room.includes('isValidReactionEmoji(r.emoji)'));
check('NodeCrypt send path validates', nodecrypt.includes('isValidReactionEmoji(safeEmoji)'));
check('chat.js quick row kept', chat.includes("const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉']"));

console.log('=== test-reactions: item 14 lazy loading + panic single import ===');
const applock = read('./client/js/util.applock.js');
const emoji = read('./client/js/util.emoji.js');
const ui = read('./client/js/ui.js');
const keyExport = read('./client/js/util.keyExport.js');
check('applock imports panic statically', applock.includes("import { panicWipe } from './util.panic.js'"));
check('no dynamic import of util.panic anywhere', ![applock, chat, ui, read('./client/js/main.js'), read('./client/js/util.settings.js')].some(s => s.includes("import('./util.panic.js')")));
check('emoji picker is dynamic-imported', emoji.includes("import('emoji-picker-element')"));
check('emoji picker has no static side-effect import', !emoji.includes("import 'emoji-picker-element';"));
check('emoji lazy load has offline fallback notice', emoji.includes('notifyEmojiLoadFailed') && emoji.includes("t('emoji.load_failed'"));
check('ui.js qrcode is dynamic-imported', ui.includes("await import('qrcode-generator')") && !ui.includes("import qrcode from 'qrcode-generator'"));
check('keyExport qrcode is dynamic-imported', keyExport.includes("await import('qrcode-generator')") && !keyExport.includes("import qrcode from 'qrcode-generator'"));

console.log('=== test-reactions: item 18 PWA install wiring ===');
const settings = read('./client/js/util.settings.js');
const pwa = read('./client/js/util.pwa.js');
const manifest = JSON.parse(read('./client/public/manifest.webmanifest'));
check('settings consumes promptInstall()', settings.includes('promptInstall()') || settings.includes('await promptInstall()'));
check('settings renders install button', settings.includes('settings-install-app'));
check('settings shows iOS guide when iOS + not installed', settings.includes('isIOSDevice()') && settings.includes('settings.ios_install_step1'));
check('util.pwa exposes install state helpers', pwa.includes('export function canInstall()') && pwa.includes('export function isStandalone()') && pwa.includes('export function isIOSDevice()'));
check('manifest has screenshots', Array.isArray(manifest.screenshots) && manifest.screenshots.length >= 2);
check('manifest has shortcuts', Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 1 && manifest.shortcuts[0].url === './');

console.log('=== test-reactions: item 19 mobile fixes ===');
const indexHtml = read('./client/index.html');
const phoneCss = read('./client/css/phone.css');
const styleCss = read('./client/css/style.css');
check('viewport has viewport-fit=cover', indexHtml.includes('viewport-fit=cover'));
check('phone.css pads top safe area', phoneCss.includes('env(safe-area-inset-top'));
check('hit-area expansion present for small buttons', styleCss.includes('.chat-search-btn::after') && styleCss.includes('.chat-voice-btn::after') && styleCss.includes('.msg-react-btn::after') && styleCss.includes('.reaction-option::after'));

console.log('=== test-reactions: item 21 i18n leak fixes ===');
const file = read('./client/js/util.file.js');
const i18n = read('./client/js/util.i18n.js');
check('settings hardcoded notify alerts removed', !settings.includes("alert('Notifications are not supported") && !settings.includes("alert('Please allow notifications"));
check('settings notify alerts go through t()', settings.includes("t('settings.notify_unsupported'") && settings.includes("t('settings.notify_denied'"));
check('file save/preview failures go through t()', file.includes("t('file.save_failed'") && file.includes("t('file.preview_failed'") && !file.includes("'Save failed: '") && !file.includes("'Preview failed: '"));
check('ui.js no-password placeholder goes through t()', ui.includes("t('ui.no_password_required'") && !ui.includes("placeholder = 'No password required'"));
for (const key of ['settings.install_app', 'settings.install_btn', 'settings.ios_install_title', 'settings.notify_unsupported', 'settings.notify_denied', 'emoji.load_failed', 'file.save_failed', 'file.preview_failed', 'ui.no_password_required', 'ui.more_emojis']) {
	const occurrences = i18n.split("'" + key + "'").length - 1;
	check('i18n key bilingual: ' + key, occurrences >= 2);
}

console.log('=== test-reactions: item 21 README ===');
const readme = read('./README.md');
check('README has feature list section', readme.includes('功能清单'));
check('README has online demo entry', readme.includes('在线体验') && readme.includes('https://chat.68626.us.ci'));
check('README demo carries deployer-bears-traffic note', readme.includes('由部署方（项目所有者）自行承担'));

console.log(`\ntest-reactions: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

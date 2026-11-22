// Items 41/42/43/45/47 (a11y + product UX batch) — zero-dependency checks in
// the repo's existing style: pure-logic unit checks against
// client/js/util.a11yUx.js plus static source assertions for the DOM wiring
// that cannot run headlessly here.
// 41/42/43/45/47（无障碍与产品体验批）：纯逻辑单测 + DOM 接线静态断言。
import { readFileSync } from 'fs';
import {
	getMentionQuery,
	filterMentionCandidates,
	recordReader,
	readerNames,
	searchMessagesAcrossRooms,
	passwordStrength,
	isWeakPassword,
	generateStrongPassword,
	classifyShortcut,
	nextRoomIndex,
	trapTabTarget,
	createThrottledAnnouncer
} from './client/js/util.a11yUx.js';

let failures = 0;
function check(name, ok, detail) {
	console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' | ' + detail : ''));
	if (!ok) failures++;
}

// ---------- 42: mention query extraction ----------
check('mention: empty text → null', getMentionQuery('') === null);
check('mention: no @ → null', getMentionQuery('hello world') === null);
check('mention: bare @ at start', JSON.stringify(getMentionQuery('@')) === JSON.stringify({ query: '', start: 0 }));
check('mention: token after space', JSON.stringify(getMentionQuery('hi @Al')) === JSON.stringify({ query: 'Al', start: 3 }));
check('mention: @ inside word is not a mention', getMentionQuery('mail@Al') === null);
check('mention: completed token + space → null', getMentionQuery('hi @Al ') === null);
check('mention: second token wins', JSON.stringify(getMentionQuery('@bob and @car')) === JSON.stringify({ query: 'car', start: 9 }));

// ---------- 42: mention candidates ----------
const userMap = {
	c1: { userName: 'Alice' },
	c2: { userName: 'albert' },
	c3: { userName: 'Bob' },
	c4: { username: 'Carol' },
	c5: { name: 'Mallory' },
	c6: {}
};
check('candidates: empty query lists named members', filterMentionCandidates(userMap, '').length === 5);
check('candidates: prefix match first, case-insensitive',
	JSON.stringify(filterMentionCandidates(userMap, 'AL').map(c => c.name)) === JSON.stringify(['albert', 'Alice', 'Mallory']));
check('candidates: prefix ranks before substring',
	filterMentionCandidates(userMap, 'a').map(c => c.name).indexOf('Alice') < filterMentionCandidates(userMap, 'a').map(c => c.name).indexOf('Carol'));
check('candidates: excludes self', filterMentionCandidates(userMap, '', 'c1').every(c => c.clientId !== 'c1'));
check('candidates: no match → empty', filterMentionCandidates(userMap, 'zzz').length === 0);
check('candidates: limit respected', filterMentionCandidates(userMap, '', null, 2).length === 2);
check('candidates: bad userMap → empty', filterMentionCandidates(null, 'a').length === 0);

// ---------- 42: read-by aggregation ----------
{
	const entry = { type: 'me' };
	check('readBy: first reader recorded', recordReader(entry, 'c2') === true && entry.read === true && entry.readBy.length === 1);
	check('readBy: duplicate reader ignored', recordReader(entry, 'c2') === false && entry.readBy.length === 1);
	check('readBy: second reader appended', recordReader(entry, 'c3') === true && entry.readBy.length === 2);
	check('readBy: empty clientId rejected', recordReader(entry, '') === false && recordReader(entry, null) === false);
	check('readBy: names resolved via userMap', JSON.stringify(readerNames(entry, userMap, 'Anon')) === JSON.stringify(['albert', 'Bob']));
	check('readBy: unknown reader falls back', JSON.stringify(readerNames({ readBy: ['cx'] }, userMap, 'Anon')) === JSON.stringify(['Anon']));
	const legacy = { read: true };
	recordReader(legacy, 'c1');
	check('readBy: legacy read=true entry gains list', legacy.readBy.length === 1);
}

// ---------- 45: cross-room search ----------
const rooms = [
	{ roomName: 'alpha', myUserName: 'me', messages: [
		{ id: 'a1', type: 'other', userName: 'Bob', msgType: 'text', text: 'hello world', timestamp: 100 },
		{ id: 'a2', type: 'me', msgType: 'text', text: 'Hello again', timestamp: 300 },
		{ id: 'a3', type: 'system', msgType: 'text', text: 'hello system', timestamp: 400 },
		{ id: 'a4', type: 'other', userName: 'Bob', msgType: 'image', text: 'hello pic', timestamp: 500 },
		{ id: 'a5', type: 'other', userName: 'Eve', msgType: 'text', text: 'burned hello', timestamp: 600, burned: true }
	] },
	{ roomName: 'beta', myUserName: 'me', messages: [
		{ id: 'b1', type: 'other', userName: 'Carol', msgType: 'text_private', text: 'say hello', timestamp: 200 },
		{ id: 'b2', type: 'other', userName: 'Dan', msgType: 'file', text: { name: 'hello.pdf' }, timestamp: 700 }
	] },
	null,
	{ roomName: 'empty', messages: [] }
];
{
	const hits = searchMessagesAcrossRooms(rooms, 'HELLO');
	check('search: cross-room hits found', hits.length === 4, 'got ' + hits.length);
	check('search: newest first', hits[0].message.id === 'a4' && hits[hits.length - 1].message.id === 'a1');
	check('search: room index/name carried', hits.some(h => h.roomIndex === 1 && h.roomName === 'beta'));
	check('search: system + burned excluded', !hits.some(h => h.message.id === 'a3' || h.message.id === 'a5'));
	check('search: non-string text excluded', !hits.some(h => h.message.id === 'b2'));
	check('search: sender filter', searchMessagesAcrossRooms(rooms, 'hello', { sender: 'bob' }).length === 2);
	check('search: sender filter matches own name', searchMessagesAcrossRooms(rooms, 'hello', { sender: 'me' }).length === 1);
	check('search: type filter text (incl _private)', searchMessagesAcrossRooms(rooms, 'hello', { type: 'text' }).length === 3);
	check('search: type filter image', searchMessagesAcrossRooms(rooms, 'hello', { type: 'image' }).length === 1);
	check('search: limit respected', searchMessagesAcrossRooms(rooms, 'hello', { limit: 2 }).length === 2);
	check('search: empty query → no hits', searchMessagesAcrossRooms(rooms, '  ').length === 0);
	check('search: null rooms tolerated', searchMessagesAcrossRooms(null, 'x').length === 0);
}

// ---------- 47: password strength + generation ----------
check('pw: empty → empty level', passwordStrength('').level === 'empty' && passwordStrength('').score === 0);
check('pw: single char weak', passwordStrength('a').level === 'weak');
check('pw: repeated char scores 0', passwordStrength('aaaaaaaaaaaa').score === 0);
check('pw: dictionary-ish short weak/fair', ['weak', 'fair'].includes(passwordStrength('password').level));
check('pw: long mixed strong', passwordStrength('Xk9#mQ2$vL8pR4z!').level === 'strong');
check('pw: isWeakPassword agrees', isWeakPassword('abc') === true && isWeakPassword('Xk9#mQ2$vL8pR4z!') === false);
{
	// deterministic byte source for the generator
	let seed = 7;
	const rng = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) { seed = (seed * 31 + 17) % 256; b[i] = seed; } return b; };
	const pw = generateStrongPassword(20, rng);
	check('pwgen: length honoured', pw.length === 20);
	check('pwgen: has all classes', /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw));
	check('pwgen: generated password scores good/strong', ['good', 'strong'].includes(passwordStrength(pw).level), pw);
	check('pwgen: min length clamped to 12', generateStrongPassword(4, rng).length === 12);
}

// ---------- 43: shortcuts ----------
check('shortcut: Ctrl+K → search', classifyShortcut({ key: 'k', ctrlKey: true }) === 'search');
check('shortcut: Cmd+K → search', classifyShortcut({ key: 'K', metaKey: true }) === 'search');
check('shortcut: Alt+ArrowUp → room-prev', classifyShortcut({ key: 'ArrowUp', altKey: true }) === 'room-prev');
check('shortcut: Alt+ArrowDown → room-next', classifyShortcut({ key: 'ArrowDown', altKey: true }) === 'room-next');
check('shortcut: panic combo NOT claimed', classifyShortcut({ key: 'Backspace', ctrlKey: true, shiftKey: true }) === null);
check('shortcut: Ctrl+Shift+K not claimed', classifyShortcut({ key: 'k', ctrlKey: true, shiftKey: true }) === null);
check('shortcut: Ctrl+W (browser reserved) not claimed', classifyShortcut({ key: 'w', ctrlKey: true }) === null);
check('shortcut: plain k not claimed', classifyShortcut({ key: 'k' }) === null);
check('shortcut: ? → help', classifyShortcut({ key: '?' }) === 'help');
check('shortcut: Ctrl+? not help', classifyShortcut({ key: '?', ctrlKey: true }) === null);
check('room nav: wraps forward', nextRoomIndex(2, 1, 3) === 0);
check('room nav: wraps backward', nextRoomIndex(0, -1, 3) === 2);
check('room nav: no rooms → -1', nextRoomIndex(0, 1, 0) === -1);
check('room nav: from none → first', nextRoomIndex(-1, 1, 3) === 0);

// ---------- 41: focus trap math + live announcer throttle ----------
check('trap: forward wraps last→first', trapTabTarget(2, 3, false) === 0);
check('trap: backward wraps first→last', trapTabTarget(0, 3, true) === 2);
check('trap: middle moves by one', trapTabTarget(1, 3, false) === 2 && trapTabTarget(1, 3, true) === 0);
check('trap: no focusables → -1', trapTabTarget(0, 0, false) === -1);
check('trap: from outside → first/last', trapTabTarget(-1, 3, false) === 0 && trapTabTarget(-1, 3, true) === 2);
{
	const written = [];
	let nowVal = 10000;
	const timers = [];
	const announce = createThrottledAnnouncer((m) => written.push(m), 1500, () => nowVal, (fn, ms) => timers.push([fn, ms]));
	announce('one');
	check('live: first announcement immediate', written.length === 1 && written[0] === 'one');
	announce('two');
	announce('three');
	check('live: burst coalesced, nothing written yet', written.length === 1);
	nowVal += 1600;
	for (const [fn] of timers.splice(0)) fn();
	check('live: trailing write is the LATEST only', written.length === 2 && written[1] === 'three');
	announce('');
	check('live: empty message ignored', written.length === 2);
}

// ---------- static wiring assertions (DOM behaviour needs a browser) ----------
const html = readFileSync('client/index.html', 'utf8');
const chat = readFileSync('client/js/chat.js', 'utf8');
const room = readFileSync('client/js/room.js', 'utf8');
const main = readFileSync('client/js/main.js', 'utf8');
const ui = readFileSync('client/js/ui.js', 'utf8');
const file = readFileSync('client/js/util.file.js', 'utf8');
const i18n = readFileSync('client/js/util.i18n.js', 'utf8');
const css = readFileSync('client/css/style.css', 'utf8');

check('html: no empty aria-label remains', !html.includes('aria-label=""'));
check('html: composer is a textbox', html.includes('role="textbox"') && html.includes('aria-multiline="true"'));
check('html: composer keyboard-focusable', html.includes('input-message-input-init" contenteditable="true" dir="auto" tabindex="0"'));
check('html: toolbar buttons labelled', ['chat-search-btn" type="button" title="🔍" aria-label=', 'chat-attach-btn chat-attach-btn-abs" type="button" title="" aria-label='].every(x => html.includes(x)));
check('css: focus-within reveals message actions', css.includes(':focus-within .bubble-actions'));
check('css: prefers-reduced-motion honoured', css.includes('@media (prefers-reduced-motion: reduce)'));
check('css: secondary text #808080 replaced for AA', !css.includes('color: #808080;') && css.includes('color: #6e6e6e;'));
check('css: sr-only helper present', css.includes('.sr-only'));
check('chat: image alt no longer bare "image"', !chat.includes('alt="image"') && chat.includes('a11y.shared_image'));
check('chat: live announcements wired', chat.includes('announceLive(') && chat.includes("'typing'") && chat.includes("'message'"));
check('chat: image modal Esc + focus restore', chat.includes("e.key === 'Escape') closeModal()") && chat.includes('restoreModalFocus()'));
check('chat: cross-room search used', chat.includes('searchMessagesAcrossRooms(roomsData, q'));
check('chat: search scope note rendered', chat.includes('search.scope'));
check('chat: search result switches room before jump', chat.includes('switchRoom(hit.roomIndex)') && chat.includes('jumpToMessage(m.id)'));
check('chat: read chip shows count + names', chat.includes('buildReadChipHtml') && chat.includes('receipt.read_by'));
check('chat: empty-room invite card present', chat.includes('jmlt-empty-room') && chat.includes('__jmltOpenShare'));
check('room: receipts keep reader identity', room.includes('recordReader(entry, r.clientId)'));
check('main: mention popup wired to userMap', main.includes('filterMentionCandidates(rd.userMap') && main.includes('getMentionQuery(before)'));
check('main: mention Enter consumed before send', main.indexOf("e.key === 'Enter' || e.key === 'Tab'") !== -1 && main.includes('stopImmediatePropagation()'));
check('main: shortcuts wired', main.includes('classifyShortcut(e)') && main.includes('toggleSearchBar()') && main.includes('showShortcutHelp'));
check('main: share bridge installed', main.includes('window.__jmltOpenShare'));
check('ui: password strength + generate wired', ui.includes('setupPasswordStrength') && ui.includes('generateStrongPassword(20)') && ui.includes('pw-strength-bar'));
check('ui: weak/empty password confirm present', ui.includes('pw.weak_confirm') && ui.includes('pw.empty_confirm'));
check('ui: invite-locked password skips confirm', ui.includes('pwdLocked'));
check('ui: share modal focus trap', ui.includes('handleModalTab(overlay, e)') && ui.includes('focusIntoModal(overlay)'));
check('file: preview Esc + focus trap', file.includes('handleModalTab(overlay, e)') && file.includes('restoreModalFocus()'));
for (const key of ['a11y.new_message', 'a11y.shared_image', 'search.scope', 'search.cross_placeholder', 'receipt.read_by', 'shortcut.title', 'invite.empty_title', 'pw.weak_confirm', 'pw.empty_confirm', 'pw.generate', 'mention.none']) {
	const n = i18n.split("'" + key + "'").length - 1;
	check('i18n key ' + key + ' in both locales', n === 2, 'occurrences=' + n);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);

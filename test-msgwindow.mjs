// test-msgwindow.mjs — Item 27: message-list DOM windowing.
// Pure-logic coverage for client/js/util.msgWindow.js plus static wiring
// assertions on client/js/chat.js (the DOM side cannot run under plain
// node; the render path itself is exercised by the browser build).
import fs from 'node:fs';
import {
	MSG_WINDOW_SIZE,
	MSG_WINDOW_PAGE,
	MSG_WINDOW_SCROLL_THRESHOLD,
	MSG_WINDOW_JUMP_CONTEXT,
	initialWindowStart,
	expandWindowStart,
	hasEarlierMessages,
	shouldExpandWindow,
	windowStartForIndex,
	clampWindowStart
} from './client/js/util.msgWindow.js';

let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ FAIL: ' + name); } }

console.log('=== msgwindow: constants ===');
check('window size is 200', MSG_WINDOW_SIZE === 200);
check('page size is 100', MSG_WINDOW_PAGE === 100);
check('scroll threshold is 240', MSG_WINDOW_SCROLL_THRESHOLD === 240);
check('jump context is 20', MSG_WINDOW_JUMP_CONTEXT === 20);

console.log('=== msgwindow: initialWindowStart ===');
check('empty array starts at 0', initialWindowStart(0) === 0);
check('short array starts at 0', initialWindowStart(50) === 0);
check('exactly one window starts at 0', initialWindowStart(200) === 0);
check('one over starts at 1', initialWindowStart(201) === 1);
check('1000 messages start at 800', initialWindowStart(1000) === 800);
check('custom size honoured', initialWindowStart(1000, 300) === 700);
check('NaN total treated as 0', initialWindowStart(NaN) === 0);
check('negative total treated as 0', initialWindowStart(-5) === 0);

console.log('=== msgwindow: expandWindowStart / hasEarlierMessages ===');
check('expand from 800 gives 700', expandWindowStart(800) === 700);
check('expand clamps at 0', expandWindowStart(50) === 0);
check('expand at 0 stays 0', expandWindowStart(0) === 0);
check('custom page honoured', expandWindowStart(800, 250) === 550);
check('has earlier at 1', hasEarlierMessages(1) === true);
check('no earlier at 0', hasEarlierMessages(0) === false);
check('no earlier when negative', hasEarlierMessages(-3) === false);

console.log('=== msgwindow: full paging sequence over 1000 messages ===');
{
	let start = initialWindowStart(1000);
	const seen = [start];
	while (hasEarlierMessages(start)) { start = expandWindowStart(start); seen.push(start); }
	check('paging reaches 0 in 8 expansions', seen.length === 9 && seen[seen.length - 1] === 0);
	check('paging is strictly decreasing until 0', seen.every((v, i) => i === 0 || v < seen[i - 1]));
	check('rendered count grows 200 -> 1000', (1000 - seen[0]) === 200 && (1000 - seen[seen.length - 1]) === 1000);
}

console.log('=== msgwindow: shouldExpandWindow ===');
check('top of view expands', shouldExpandWindow(0, 100) === true);
check('at threshold expands', shouldExpandWindow(240, 100) === true);
check('below threshold does not expand', shouldExpandWindow(241, 100) === false);
check('no expansion when nothing earlier', shouldExpandWindow(0, 0) === false);
check('NaN scrollTop does not expand', shouldExpandWindow(NaN, 100) === false);

console.log('=== msgwindow: windowStartForIndex (jump) ===');
check('target inside window keeps start', windowStartForIndex(900, 800) === 800);
check('target at window edge keeps start', windowStartForIndex(800, 800) === 800);
check('target above window gets context above it', windowStartForIndex(500, 800) === 480);
check('target near top clamps to 0', windowStartForIndex(10, 800) === 0);
check('first message clamps to 0', windowStartForIndex(0, 800) === 0);

console.log('=== msgwindow: clampWindowStart ===');
check('in-range start unchanged', clampWindowStart(900, 1000) === 900);
check('start past shrunk end clamps to end', clampWindowStart(1500, 1000) === 1000);
check('negative start clamps to 0', clampWindowStart(-5, 100) === 0);
check('start on empty array is 0', clampWindowStart(10, 0) === 0);

console.log('=== msgwindow: chat.js wiring (static) ===');
const chatSrc = fs.readFileSync(new URL('./client/js/chat.js', import.meta.url), 'utf8');
const utilSrc = fs.readFileSync(new URL('./client/js/util.msgWindow.js', import.meta.url), 'utf8');
check('chat.js imports the window helpers', chatSrc.includes("from './util.msgWindow.js'"));
check('renderChatArea lands on the initial window', chatSrc.includes('initialWindowStart(rd.messages.length)'));
check('slice renders from msgWindowStart', chatSrc.includes('for (let i = msgWindowStart; i < rd.messages.length; i++)'));
check('scroll hook consults shouldExpandWindow', chatSrc.includes("on(chatArea, 'scroll'") && chatSrc.includes('shouldExpandWindow(chatArea.scrollTop, msgWindowStart)'));
check('expansion restores scroll position by height delta', chatSrc.includes('prevTop + Math.max(0, chatArea.scrollHeight - prevHeight)'));
check('jump expands the window for in-memory targets', chatSrc.includes('windowStartForIndex(idx, msgWindowStart)') && chatSrc.includes('rd.messages.findIndex'));
check('jump keeps the not-loaded fallback for absent messages', chatSrc.includes('search.not_loaded'));
// (length check targets assignment only; a === comparison is not trimming)
check('chat.js never trims the data array', !/\.messages\.(splice|shift|pop)\s*\(/.test(chatSrc) && !/\.messages\.length\s*=[^=]/.test(chatSrc));
check('util module stays DOM-free', !/document\.|window\.(document|location|addEventListener)|localStorage/.test(utilSrc));

console.log(`\ntest-msgwindow: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

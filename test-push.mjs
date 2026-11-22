// S-3: Web Push endpoint allowlist tests for worker/push.js
// isAcceptableEndpoint. Table-driven: real endpoint shapes for the four push
// services must pass; look-alike / smuggled hosts must fail.
// Run: node test-push.mjs
// S-3：Web Push 端点白名单测试。表驱动：四家真实端点形态放行，仿冒/夹带主机拒绝。
// Note: importing worker/push.js was verified to have no top-level side
// effects (only constants + function definitions), so no relocation needed.
// 注：已验证 import worker/push.js 无顶层副作用，函数无需挪动。
import { isAcceptableEndpoint } from './worker/push.js';

let passed = 0;
let failed = 0;

function check(name, cond) {
	if (cond) {
		passed++;
		console.log(`  ✓ ${name}`);
	} else {
		failed++;
		console.error(`  ✗ FAIL: ${name}`);
	}
}

console.log('=== test-push: allow real push-service endpoints ===');
const allowCases = [
	['FCM (Chrome/Chromium)', 'https://fcm.googleapis.com/fcm/send/dummy-token-123'],
	['Mozilla Autopush (Firefox)', 'https://updates.push.services.mozilla.com/wpush/v2/dummy-token-123'],
	['Apple Web Push (Safari)', 'https://web.push.apple.com/Qabc123dummyToken'],
	['Microsoft WNS (Edge)', 'https://wns2-db5p.notify.windows.com/w/?token=AwYAAADdummy123'],
	['FCM with explicit :443 port', 'https://fcm.googleapis.com:443/fcm/send/dummy-token-123'],
];
for (const [name, ep] of allowCases) {
	check(`allows ${name}`, isAcceptableEndpoint(ep) === true);
}

console.log('=== test-push: reject look-alike / smuggled endpoints ===');
const rejectCases = [
	['suffix look-alike fcm.googleapis.com.evil.com', 'https://fcm.googleapis.com.evil.com/fcm/send/abc123'],
	['fragment smuggling evil.com#fcm.googleapis.com', 'https://evil.com/#fcm.googleapis.com'],
	['userinfo smuggling fcm.googleapis.com@evil.com', 'https://fcm.googleapis.com@evil.com/wpush'],
	['apple suffix look-alike x.push.apple.com.evil.com', 'https://x.push.apple.com.evil.com/abc123456789'],
	['evilpush.apple.com (no label boundary)', 'https://evilpush.apple.com/abc1234567890'],
	['fakepush.apple.com (no label boundary)', 'https://fakepush.apple.com/abc1234567890'],
	['bare push.apple.com', 'https://push.apple.com/abc1234567890123'],
	['IP literal', 'https://192.168.1.1/push/abc1234567890'],
	['non-443 port', 'https://fcm.googleapis.com:8443/fcm/send/abc123'],
	['trailing-dot host', 'https://fcm.googleapis.com./fcm/send/abc123'],
	['http (not https)', 'http://fcm.googleapis.com/fcm/send/abc123'],
	['legacy FCM host android.googleapis.com (deliberately not allowlisted)', 'https://android.googleapis.com/gcm/send/abc123456'],
];
for (const [name, ep] of rejectCases) {
	check(`rejects ${name}`, isAcceptableEndpoint(ep) === false);
}

console.log('=== test-push: length boundaries (20 / 500 retained) ===');
// Shortest allowlisted endpoint is >20 chars, so the 20-char lower bound is
// exercised as a gate check (a 20-char non-endpoint must not pass, a 19-char
// string is below the minimum), and the 500-char upper bound is exercised
// with a real FCM endpoint padded to exactly 500 / 501 chars.
check('rejects 19-char endpoint (below min length)', isAcceptableEndpoint('x'.repeat(19)) === false);
check('rejects 20-char non-endpoint (at min length, not allowlisted)', isAcceptableEndpoint('x'.repeat(20)) === false);
const fcmBase = 'https://fcm.googleapis.com/fcm/send/';
const ep500 = fcmBase + 'a'.repeat(500 - fcmBase.length);
const ep501 = fcmBase + 'a'.repeat(501 - fcmBase.length);
check('accepts allowlisted endpoint at exactly 500 chars', ep500.length === 500 && isAcceptableEndpoint(ep500) === true);
check('rejects allowlisted endpoint at 501 chars (above max length)', ep501.length === 501 && isAcceptableEndpoint(ep501) === false);

console.log(`\ntest-push: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

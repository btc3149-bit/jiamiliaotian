// Documentation static assertions (X-1, PR-1). Guards the corrected key
// derivation formula, the unauthenticated-join disclosure, the legacy
// replay scope disclosure and the default-server attribution against
// silent regression. Docker header assertions join in PR-2.
// 文档静态断言：锁住密钥公式纠错、入房无鉴权声明、legacy 重放范围声明与
// 默认服务器归属说明，防静默回退。Docker 组断言随 PR-2 加入。
// Run: node test-docs.mjs
import fs from 'node:fs';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

const zh = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');
const en = fs.readFileSync(new URL('./README_EN.md', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('./RULES.md', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');

console.log('=== test-docs: key derivation formula (D-1) ===');
check('zh formula uses PBKDF2-SHA256', zh.includes('PBKDF2-SHA256(房间密码'));
check('zh formula names the salt', zh.includes("'nodecrypt:v2:' + 房间名"));
check('zh formula states 200000 iterations', zh.includes('迭代 200000 次'));
check('en formula uses PBKDF2-SHA256', en.includes('PBKDF2-SHA256(Room Password'));
check('en formula names the salt', en.includes("'nodecrypt:v2:' + Room Name"));
check('en formula states 200,000 iterations', en.includes('200,000 iterations'));
check('zh flowchart uses PBKDF2 formula', zh.includes("PBKDF2-SHA256(密码, 'nodecrypt:v2:'+房间名, 200k)"));
check('en flowchart uses PBKDF2 formula', en.includes("PBKDF2-SHA256(password, 'nodecrypt:v2:'+Room Name, 200k)"));
check('no stale XOR SHA256 formula (zh)', !zh.includes('XOR SHA256(房间密码)') && !zh.includes('XOR SHA256(密码)'));
check('no stale XOR SHA256 formula (en)', !en.includes('XOR SHA256(Room Password)') && !en.includes('XOR SHA256(password)'));
check('no ISC contradiction (zh)', !zh.includes('本项目采用 ISC'));
check('no ISC contradiction (en)', !en.includes('uses the ISC open source license'));

console.log('=== test-docs: unauthenticated join disclosure (D-2) ===');
check('zh README declares no transport-layer join auth', zh.includes('入房在传输层不做身份鉴权'));
check('zh README states password is the only content defense', zh.includes('房间密码是唯一的内容防线'));
check('en README declares no transport-layer join auth', en.includes('No transport-layer authentication for joining'));
check('en README states password is the only content defense', en.includes('the only content defense'));
check('RULES registers the trade-off', rules.includes('入房在传输层不做身份鉴权') && rules.includes('已知设计取舍'));

console.log('=== test-docs: legacy replay scope disclosure (E-3) ===');
check('zh README discloses legacy replay scope', zh.includes('重放防护的覆盖范围'));
check('en README discloses legacy replay scope', en.includes('Scope of Replay Protection'));

console.log('=== test-docs: default server attribution (D-4) ===');
check('zh README attributes default server domain', zh.includes('chat.68626.us.ci') && zh.includes('项目方自有部署'));

console.log('=== test-docs: docker security headers (K-1, PR-2) ===');
check('docker CSP has media-src with data:', dockerfile.includes("media-src 'self' data: blob:"));
check('docker Permissions-Policy allows self camera/mic', dockerfile.includes('camera=(self), microphone=(self)'));
const cspLine = (dockerfile.match(/add_header Content-Security-Policy "[^"]*"/) || [''])[0];
check('docker connect-src has no bare https:', !!cspLine && !/connect-src[^;"]*\bhttps:/.test(cspLine));
check('zh README carries TLS/HSTS proxy statement', zh.includes('Strict-Transport-Security') && zh.includes('TLS 终结'));

console.log(`\ntest-docs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// Zero-dependency test runner (item 2). Replaces the hand-written `&&`
// chain in package.json that once silently dropped test-v192 from CI.
// Discovers every test-*.mjs in the repo root by glob.
//
// ORDER: the legacy chain in package.json was NOT alphabetical
// (crypto, localHistory, protocol, markdown, export, migration, ratchet,
// ratchet-integration, filestream, v192, docs, ratelimit,
// server-integration, push, share-sw). To keep behaviour identical to the
// old chain, those 15 files run in LEGACY_ORDER first; any newly added
// test-*.mjs files are appended afterwards in alphabetical order, so a new
// test file is picked up automatically without editing this file.
// Semantics match the old `&&` chain: stop at the first failing file and
// exit non-zero.
// Run: node scripts/run-tests.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const LEGACY_ORDER = [
	'test-crypto.mjs',
	'test-localHistory.mjs',
	'test-protocol.mjs',
	'test-markdown.mjs',
	'test-export.mjs',
	'test-migration.mjs',
	'test-ratchet.mjs',
	'test-ratchet-integration.mjs',
	'test-filestream.mjs',
	'test-v192.mjs',
	'test-docs.mjs',
	'test-ratelimit.mjs',
	'test-server-integration.mjs',
	'test-push.mjs',
	'test-share-sw.mjs',
];

const discovered = fs.readdirSync(root)
	.filter((f) => /^test-.+\.mjs$/.test(f))
	.sort();
const ordered = [
	...LEGACY_ORDER.filter((f) => discovered.includes(f)),
	...discovered.filter((f) => !LEGACY_ORDER.includes(f)),
];

if (ordered.length === 0) {
	console.error('run-tests: no test-*.mjs files found');
	process.exit(1);
}

console.log(`run-tests: ${ordered.length} test files: ${ordered.join(', ')}`);
let totalPassed = 0;
for (const file of ordered) {
	console.log(`\n▶ ${file}`);
	const res = spawnSync(process.execPath, [path.join(root, file)], { stdio: 'inherit', cwd: root });
	if (res.status !== 0) {
		console.error(`run-tests: FAILED at ${file} (exit ${res.status === null ? res.signal : res.status}) — remaining files skipped (same as old && chain)`);
		process.exit(res.status === null ? 1 : res.status);
	}
	totalPassed++;
}
console.log(`\nrun-tests: all ${totalPassed} test files passed`);

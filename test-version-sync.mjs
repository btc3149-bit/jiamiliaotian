// test-version-sync: the three version locations (package.json,
// tauri.conf.json, Cargo.toml) must agree, and scripts/sync-version.mjs
// must report that agreement via its --check mode.
// Run standalone: node test-version-sync.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions } from './scripts/sync-version.mjs';

const root = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const { ok, versions, version } = checkVersions();
check('all version locations agree', ok);
check('version is semver-shaped', !!version && /^\d+\.\d+\.\d+/.test(version));
check('package.json carries a version', typeof versions['package.json'] === 'string');
check('tauri.conf.json matches package.json', versions['desktop/src-tauri/tauri.conf.json'] === versions['package.json']);
check('Cargo.toml matches package.json', versions['desktop/src-tauri/Cargo.toml'] === versions['package.json']);

let cliOk = false;
try {
  const out = execFileSync(process.execPath, [join(root, 'scripts/sync-version.mjs'), '--check'], { encoding: 'utf8' });
  cliOk = out.includes('all locations agree');
} catch { cliOk = false; }
check('sync-version.mjs --check exits 0 and reports agreement', cliOk);

console.log(`test-version-sync: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

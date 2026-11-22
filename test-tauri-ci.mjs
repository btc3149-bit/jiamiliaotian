// Tauri CI static assertions (review item 33). Guards the switch from
// source-compiled tauri-cli (`cargo install tauri-cli`, repeated in every
// CI job) to the pinned npm @tauri-apps/cli prebuilt binary: no workflow may
// reintroduce a source build, a floating @latest CLI, or a `cargo tauri`
// invocation, and the CLI version must stay exactly pinned and on the same
// major line as the `tauri` crate in desktop/src-tauri/Cargo.toml.
// Tauri CI 静态断言（评审第 33 条）：锁住「去源码编译 tauri-cli」——workflow
// 不得再出现 cargo install tauri-cli / cargo tauri / @latest 浮动版，
// desktop/package.json 的 @tauri-apps/cli 必须钉确切版本且与 Cargo.toml
// 的 tauri 依赖同大版本，锁文件与之保持一致。
// Run: node test-tauri-ci.mjs
import fs from 'node:fs';

let passed = 0;
let failed = 0;
function check(name, cond) {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const desktopYml = read('./.github/workflows/desktop.yml');
const androidYml = read('./.github/workflows/android.yml');
const cargoToml = read('./desktop/src-tauri/Cargo.toml');
const desktopPkg = JSON.parse(read('./desktop/package.json'));
const desktopLock = JSON.parse(read('./desktop/package-lock.json'));

console.log('=== test-tauri-ci: no source-compiled tauri-cli in workflows ===');
for (const [label, yml] of [['desktop.yml', desktopYml], ['android.yml', androidYml]]) {
	check(`${label} has no cargo install tauri-cli`, !yml.includes('cargo install tauri-cli'));
	check(`${label} has no cargo install at all`, !yml.includes('cargo install'));
	check(`${label} has no cargo tauri subcommand`, !yml.includes('cargo tauri'));
	check(`${label} has no floating @latest CLI`, !yml.includes('@tauri-apps/cli@latest') && !yml.includes('@latest'));
	check(`${label} keeps the Rust toolchain step (app build still needs cargo)`, yml.includes('rust-toolchain'));
	check(`${label} installs the pinned npm CLI from desktop/`, yml.includes('working-directory: desktop') && yml.includes('npm ci --ignore-scripts'));
}

console.log('=== test-tauri-ci: workflows drive the npm CLI ===');
check('desktop.yml builds via npx tauri build', desktopYml.includes('npx tauri build'));
check('desktop.yml derives icons via npx tauri icon', desktopYml.includes('npx tauri icon'));
check('android.yml inits via npx tauri android init', androidYml.includes('npx tauri android init'));
check('android.yml builds APK via npx tauri android build --apk', androidYml.includes('npx tauri android build --apk'));
check('android.yml builds AAB via npx tauri android build --aab', androidYml.includes('npx tauri android build --aab'));
check('android.yml derives icons via npx tauri icon', androidYml.includes('npx tauri icon'));

console.log('=== test-tauri-ci: CLI version is exactly pinned and matches the tauri crate ===');
const cliVersion = (desktopPkg.devDependencies || {})['@tauri-apps/cli'];
check('desktop/package.json declares @tauri-apps/cli in devDependencies', typeof cliVersion === 'string');
check('CLI version is an exact pin (no ^, ~, range or tag)', /^\d+\.\d+\.\d+$/.test(cliVersion || ''));
const crateMajor = (cargoToml.match(/^tauri\s*=\s*\{\s*version\s*=\s*"(\d+)"/m) || [])[1];
check('Cargo.toml tauri crate major version is parseable', typeof crateMajor === 'string');
check('CLI major matches tauri crate major', !!cliVersion && cliVersion.split('.')[0] === crateMajor);
const lockedCli = desktopLock.packages && desktopLock.packages['node_modules/@tauri-apps/cli'];
check('package-lock.json resolves @tauri-apps/cli', !!lockedCli);
check('package-lock.json CLI version equals the pin', !!lockedCli && lockedCli.version === cliVersion);
check('package-lock.json root spec equals the pin',
	!!desktopLock.packages && !!desktopLock.packages[''] &&
	desktopLock.packages[''].devDependencies['@tauri-apps/cli'] === cliVersion);

console.log(`\ntest-tauri-ci: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

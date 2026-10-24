#!/usr/bin/env node
// v1.7.0 #18: apply release signing to a freshly `cargo tauri android init`-ed
// project. The gen/android directory is generated in CI (never committed), so
// the official keystore.properties + signingConfigs approach (see
// https://v2.tauri.app/distribute/sign/android/) is applied as a surgical,
// idempotent patch right after init and before build.
//
// v1.7.0 #18：给 CI 现生成的 gen/android 打 release 签名补丁。gen/android
// 不入库（每次 cargo tauri android init 现生成），因此官方的
// keystore.properties + signingConfigs 方案在 init 之后、build 之前以
// 幂等补丁方式落地。
//
// Usage:
//   node scripts/android-apply-signing.mjs [gen-android-dir]
//     (default: desktop/src-tauri/gen/android)
//
// Expects <gen-android>/keystore.properties to already exist (the CI step
// writes it from secrets). Optional env VERSION_CODE overrides versionCode.
//
// Idempotent: a `// jmlt-signing-patch` marker short-circuits re-runs.
// Fails LOUDLY (exit 1) if any anchor is missing — a silently unsigned
// release build is worse than a failed one.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const genDir = process.argv[2] || 'desktop/src-tauri/gen/android';
const gradlePath = join(genDir, 'app', 'build.gradle.kts');
const propsPath = join(genDir, 'keystore.properties');

function die(msg) {
	console.error('android-apply-signing: ' + msg);
	process.exit(1);
}

if (!existsSync(gradlePath)) die(`not found: ${gradlePath} (run 'cargo tauri android init' first)`);
if (!existsSync(propsPath)) die(`not found: ${propsPath} (CI must write it from secrets before calling this script)`);

let src = readFileSync(gradlePath, 'utf8');

if (src.includes('jmlt-signing-patch')) {
	console.log('android-apply-signing: patch already applied, skipping');
	process.exit(0);
}

// ---- 1. imports (only what the template lacks) ----
const imports = [];
if (!/^import java\.io\.FileInputStream/m.test(src)) imports.push('import java.io.FileInputStream');
if (!/^import java\.util\.Properties/m.test(src)) imports.push('import java.util.Properties');
if (imports.length) {
	// insert right after the last leading import, or at the top of the file
	const lines = src.split('\n');
	let lastImport = -1;
	for (let i = 0; i < Math.min(lines.length, 30); i++) {
		if (/^import /.test(lines[i])) lastImport = i;
	}
	lines.splice(lastImport + 1, 0, ...imports);
	src = lines.join('\n');
}

// ---- 2. versionCode override (optional, for Play Store uploads) ----
const versionCode = process.env.VERSION_CODE;
	if (versionCode) {
		if (!/^\d+$/.test(versionCode)) die('VERSION_CODE must be a positive integer');
		if (/^\s*versionCode\s*=/m.test(src)) {
		src = src.replace(/^(\s*)versionCode\s*=\s*\d+/m, `$1versionCode = ${versionCode}`);
	} else if (/^(\s*)defaultConfig\s*\{/m.test(src)) {
		src = src.replace(/^(\s*)defaultConfig\s*\{/m, `$1defaultConfig {\n$1    versionCode = ${versionCode}`);
	} else {
		die('could not find a versionCode line or a defaultConfig block — VERSION_CODE not applied');
	}
	console.log('android-apply-signing: versionCode ->', versionCode);
}

// ---- 3. signingConfigs block before buildTypes ----
const signingBlock = [
	'    // jmlt-signing-patch: official Tauri Android signing (keystore.properties)',
	'    signingConfigs {',
	'        create("release") {',
	'            val keystorePropertiesFile = rootProject.file("keystore.properties")',
	'            val keystoreProperties = Properties()',
	'            if (keystorePropertiesFile.exists()) {',
	'                keystoreProperties.load(FileInputStream(keystorePropertiesFile))',
	'            }',
	'            keyAlias = keystoreProperties["keyAlias"] as String',
	'            keyPassword = keystoreProperties["password"] as String',
	'            storeFile = file(keystoreProperties["storeFile"] as String)',
	'            storePassword = keystoreProperties["password"] as String',
	'        }',
	'    }',
	''
].join('\n');

const btIndex = src.search(/^(\s*)buildTypes\s*\{/m);
if (btIndex < 0) die('anchor "buildTypes {" not found in app/build.gradle.kts');
// keep the original indentation of the buildTypes line for our block
const btIndent = src.slice(btIndex).match(/^(\s*)/)[1];
src = src.slice(0, btIndex) + signingBlock.replace(/^ {4}/gm, btIndent) + src.slice(btIndex);

// ---- 4. wire release buildType to the signing config ----
// insert inside the first `getByName("release") {` after buildTypes
const btPos = src.search(/^(\s*)buildTypes\s*\{/m);
const relMatch = src.slice(btPos).match(/^(\s*)getByName\("release"\)\s*\{/m);
if (!relMatch) die('anchor "getByName(\\"release\\") {" not found inside buildTypes');
const relPos = btPos + src.slice(btPos).indexOf(relMatch[0]);
const relIndent = relMatch[1];
src = src.slice(0, relPos + relMatch[0].length) +
	`\n${relIndent}    signingConfig = signingConfigs.getByName("release")` +
	src.slice(relPos + relMatch[0].length);

writeFileSync(gradlePath, src);
console.log('android-apply-signing: patched', gradlePath);

#!/usr/bin/env node
// sync-version.mjs — keep the app version in sync across the three
// places that carry it:
//   1. package.json                       ("version")
//   2. desktop/src-tauri/tauri.conf.json  ("version")
//   3. desktop/src-tauri/Cargo.toml       ([package] version)
// package-lock.json (top-level "version" and packages[""].version)
// is kept in sync with package.json as well.
//
// Usage:
//   node scripts/sync-version.mjs --check   verify all locations agree
//   node scripts/sync-version.mjs <x.y.z>   set that version everywhere
//   node scripts/sync-version.mjs           sync everywhere to package.json's version
//
// Exit code is non-zero on mismatch (--check) or invalid input.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const pkgPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const tauriConfPath = join(root, 'desktop/src-tauri/tauri.conf.json');
const cargoPath = join(root, 'desktop/src-tauri/Cargo.toml');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function cargoVersion(text) {
  // First `version = "..."` inside the [package] section.
  const pkgSection = text.split(/^\[/m)[1] || '';
  const m = pkgSection.match(/^version\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

export function collectVersions() {
  const pkg = readJson(pkgPath);
  const tauri = readJson(tauriConfPath);
  const cargo = cargoVersion(readFileSync(cargoPath, 'utf8'));
  const versions = {
    'package.json': pkg.version,
    'desktop/src-tauri/tauri.conf.json': tauri.version,
    'desktop/src-tauri/Cargo.toml': cargo,
  };
  try {
    const lock = readJson(lockPath);
    versions['package-lock.json'] = lock.version;
    if (lock.packages && lock.packages['']) {
      versions['package-lock.json (packages[""])'] = lock.packages[''].version;
    }
  } catch {
    // lockfile is optional for the check; npm regenerates it.
  }
  return versions;
}

export function checkVersions() {
  const versions = collectVersions();
  const values = Object.values(versions);
  const ok = values.every((v) => v && v === values[0]);
  return { ok, versions, version: ok ? values[0] : null };
}

function setVersion(target) {
  if (!SEMVER.test(target)) {
    console.error(`sync-version: "${target}" is not a valid semver version`);
    process.exit(2);
  }
  const pkgText = readFileSync(pkgPath, 'utf8');
  writeFileSync(pkgPath, pkgText.replace(/"version":\s*"[^"]+"/, `"version": "${target}"`));

  try {
    // Textual replace of the first two "version" fields (top-level and
    // packages[""]) so the rest of the lockfile stays byte-identical.
    let n = 0;
    const lockText = readFileSync(lockPath, 'utf8').replace(/"version":\s*"[^"]+"/g, (m) =>
      ++n <= 2 ? `"version": "${target}"` : m,
    );
    writeFileSync(lockPath, lockText);
  } catch {
    // no lockfile present — nothing to sync there
  }

  const tauriText = readFileSync(tauriConfPath, 'utf8');
  writeFileSync(tauriConfPath, tauriText.replace(/"version":\s*"[^"]+"/, `"version": "${target}"`));

  const cargoText = readFileSync(cargoPath, 'utf8');
  const idx = cargoText.indexOf('[package]');
  const head = cargoText.slice(0, idx);
  const rest = cargoText.slice(idx).replace(/^version\s*=\s*"[^"]+"/m, `version = "${target}"`);
  writeFileSync(cargoPath, head + rest);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const { ok, versions } = checkVersions();
    for (const [where, v] of Object.entries(versions)) console.log(`${where}: ${v}`);
    if (!ok) {
      console.error('sync-version: version mismatch across locations (see above)');
      process.exit(1);
    }
    console.log(`sync-version: all locations agree on ${versions['package.json']}`);
  } else {
    const target = arg || readJson(pkgPath).version;
    setVersion(target);
    const { ok, versions } = checkVersions();
    if (!ok) {
      console.error('sync-version: sync failed, locations still disagree:', versions);
      process.exit(1);
    }
    console.log(`sync-version: all locations set to ${target}`);
  }
}

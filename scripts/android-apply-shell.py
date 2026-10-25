#!/usr/bin/env python3
# v1.9.0: patch the CI-generated Tauri Android project for media access.
#
# Why: wry 0.57 already bridges WebView onPermissionRequest -> Android runtime
# permission dialog -> grant (RustWebChromeClient.kt), but the request can only
# succeed if the permissions are DECLARED in AndroidManifest.xml. The generated
# manifest only declares INTERNET, so getUserMedia(mic/cam) is auto-denied ->
# voice messages fail with "无法录音(permission)" and P2P calls cancel with
# "无法访问麦克风/摄像头". This script declares the missing permissions.
#
# Downloads: Android WebView cannot download blob: URLs at all (no
# DownloadListener in wry), so the web client falls back to an in-app image
# preview + Web Share / anchor-download chain (see util.file.js); no native
# patch is possible here without touching wry internals.
#
# Idempotent: safe to run multiple times. Usage:
#   node scripts/android-apply-shell.mjs <gen/android dir>
import os, re, sys

GEN = sys.argv[1] if len(sys.argv) > 1 else os.path.join("desktop", "src-tauri", "gen", "android")
MANIFEST = os.path.join(GEN, "app", "src", "main", "AndroidManifest.xml")

PERMISSIONS = [
    "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA",
    "android.permission.MODIFY_AUDIO_SETTINGS",
]

def die(msg):
    print("ERROR:", msg)
    sys.exit(1)

if not os.path.isfile(MANIFEST):
    die(f"manifest not found: {MANIFEST} (run `cargo tauri android init` first)")

src = open(MANIFEST, encoding="utf-8").read()
changed = False
for perm in PERMISSIONS:
    if perm in src:
        print("already declared:", perm)
        continue
    tag = f'    <uses-permission android:name="{perm}" />\n'
    if "</manifest>" not in src:
        die("no </manifest> anchor")
    src = src.replace("</manifest>", tag + "</manifest>", 1)
    changed = True
    print("declared:", perm)

# Declaring camera/mic features as NOT required keeps the app installable on
# devices without them (chat works fine; calls just won't).
FEATURES = [
    ("android.hardware.microphone", "false"),
    ("android.hardware.camera", "false"),
]
for name, required in FEATURES:
    needle = f'android:name="{name}"'
    if needle in src:
        print("feature already declared:", name)
        continue
    tag = f'    <uses-feature android:name="{name}" android:required="{required}" />\n'
    src = src.replace("</manifest>", tag + "</manifest>", 1)
    changed = True
    print("declared feature:", name, "required=false")

if changed:
    open(MANIFEST, "w", encoding="utf-8", newline="\n").write(src)
    print("manifest patched:", MANIFEST)
else:
    print("manifest unchanged")

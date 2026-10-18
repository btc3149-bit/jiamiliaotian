# 桌面端 / Desktop (Tauri 2)

加米辽田桌面壳：把 web client 打包成 Windows / macOS / Linux 原生应用。

## 架构与安全边界

- 壳 = 系统 WebView + 打包进二进制的 web client（`frontendDist: ../dist`）
- **零原生 IPC 能力**（capabilities 只有 `core:default`）——所有加密逻辑仍在 web 层，壳没有读写文件、执行命令等任何特权
- 服务器地址由用户在 **设置 → 服务器地址** 里填写自己的部署（`https://`，会被校验），留空则回退同源；也可以用 `?server=` 参数指定
- CSP 由 `tauri.conf.json` 提供，与 worker 注入的同级：`connect-src https: wss:` 允许连用户自己的服务器，其余同 worker 策略

## 本地构建

前置：Node 20+、Rust stable、平台依赖（Linux 需 `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`）。

```bash
# 1. 构建 web client（Tauri 直接吞 dist/）
npm ci --ignore-scripts
npm run build

# 2. 派生平台图标（.ico/.icns 从 1024 源图生成）
npx @tauri-apps/cli icon desktop/src-tauri/icons/icon-source.png -o desktop/src-tauri/icons

# 3. 构建（产物在 desktop/src-tauri/target/release/bundle/）
cd desktop/src-tauri
cargo install tauri-cli --version '^2' --locked
cargo tauri build

# 开发模式（热重载，先跑过第 1 步）
cargo tauri dev
```

## CI 构建

`.github/workflows/desktop.yml`：手动触发或推 `v*` tag → 三平台构建 → artifacts 上传。
macOS 产物为 ad-hoc 签名（未加入 Apple 开发者计划），首次打开需右键 → 打开。

# 移动端脚手架 / Mobile (Tauri 2)

Tauri 2 同一代码库可出 Android/iOS。**注意：移动端构建无法在 CI 里完成签名/上架，需要本机 SDK。**

## Android

```bash
# 前置：Android Studio（SDK + NDK）、Rust、JDK 17
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npx @tauri-apps/cli android init   # 在 desktop/ 下生成 gen/android 工程
npm run build                       # web client
npx @tauri-apps/cli android dev     # 真机调试
npx @tauri-apps/cli android build   # 产出 APK/AAB（自动签名用 debug keystore；发布需自建 keystore）
```

## iOS

```bash
# 前置：macOS + Xcode + Apple 开发者账号（$99/年，真机/上架必需）
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npx @tauri-apps/cli ios init
npm run build
npx @tauri-apps/cli ios dev
npx @tauri-apps/cli ios build
```

## 移动端安全提示

- WebView 内 localStorage/sessionStorage 随系统备份可能落盘——本地加密历史功能仍启用为佳（本来就密文）
- iOS 上 Web Push 需 16.4+ 且「添加到主屏幕」的 PWA 才支持；Tauri 壳内推送不可用，属已知边界
- 首次填服务器地址时确认是 `https://`（客户端已做校验并拒绝非 https）

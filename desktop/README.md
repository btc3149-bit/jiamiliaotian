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

### 零配置开箱（v1.8.0 #20：构建期烤入默认服务器）

桌面/安卓壳不再要求用户手填服务器地址：打 tag 前在仓库 **Settings → Secrets and variables → Actions → Variables** 建 `JMLT_DEFAULT_SERVER_URL`（值如 `https://your-worker.workers.dev`），CI 构建时经 `JMLT_DEFAULT_SERVER` 注入并烤进产物——装上即连你的部署。规则：

- 仅接受 `https://` origin（消毒函数 `sanitizeBakedServerUrl`，任何可疑输入一律回退同源，绝不降级 http）
- 优先级：`?server=` 参数 > 应用内手动设置 > **烤入默认** > 同源——烤入值永远可被手动覆盖，不是锁定
- 它是仓库**变量（Variables）不是 secret**：地址会编译进分发的二进制里，本来就不是秘密
- 不设置该变量时，行为与旧版完全一致（手动填 / 同源）
- v1.8.1 起，官方部署 `https://nodecrypt.btc31415926eth.workers.dev` 作为代码级内置默认（`vite.config.js`）；设置 `JMLT_DEFAULT_SERVER_URL` 变量或本地 `JMLT_DEFAULT_SERVER` 环境变量即可覆盖

## Android

```bash
# 前置：Android Studio（SDK + NDK）、Rust、JDK 17
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npx @tauri-apps/cli android init   # 在 desktop/ 下生成 gen/android 工程
npm run build                       # web client
npx @tauri-apps/cli android dev     # 真机调试
npx @tauri-apps/cli android build   # 产出 APK/AAB（自动签名用 debug keystore；发布需自建 keystore）
```

## Android 正式签名与 Google Play 上架（v1.7.0 #18）

CI 的 `android.yml` 支持**可选**的正式签名：仓库里不持有任何密钥材料，你把自己的上传密钥通过 GitHub Secrets 注入，流水线自动产出 release 签名 APK + Play 上传用 AAB；不配置则保持 debug 签名（仅侧载）。

### 一次性：生成上传密钥（本地，妥善保管，切勿入库）

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool` 在 JDK / Android Studio（`jbr/bin/keytool`）里。**丢失 keystore = 永久失去该应用的更新权**，务必备份。

### 一次性：配置 GitHub Secrets（仓库 → Settings → Secrets → Actions）

| Secret | 内容 |
|---|---|
| `ANDROID_KEY_BASE64` | `base64 -i upload-keystore.jks`（Windows: `certutil -encode upload-keystore.jks keystore.b64` 后取正文） |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | keytool 时设置的口令 |
| `ANDROID_VERSION_CODE`（可选） | 正整数；每次上 Play 前递增（不设则用模板默认） |

配好后的下一个 `v*` tag 会额外产出 `jiamiliaotian_<ver>_android.aab`，且三个 APK 改为 release 签名。签名实现 = 官方方案（`gen/android/keystore.properties` + gradle `signingConfigs`，由 `scripts/android-apply-signing.mjs` 在 CI 里对现生成的工程幂等打补丁）。

### Google Play Console 上架清单

1. 开发者账号（一次性 $25，需身份验证）
2. 创建应用 → 上传 `*.aab`（内部测试轨道先行）
3. 商店资料：应用名/描述/截图/图标（`desktop/src-tauri/icons/icon-source.png` 可复用）
4. **隐私政策 URL（必需）**：如实写明——本应用零服务器存储、全部端到端加密、无分析 SDK、无第三方数据收集
5. 数据安全表单：选择「不收集/不共享任何数据」（与实际架构一致）
6. 内容分级问卷 → 完成后提交审核
7. 每次更新：递增 `ANDROID_VERSION_CODE` → 打新 tag

### iOS（诚实边界）

需 Apple 开发者账号（$99/年）+ macOS + Xcode 手动 Archive → Distribute，CI 不做（苹果签名必须在本机钥匙串里走 Xcode）。步骤见上文 iOS 脚手架。

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

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

# 2. 安装钉版 Tauri CLI（desktop/package.json 里锁定的 @tauri-apps/cli 预编译
#    二进制；不要再用 cargo 从源码编译 CLI，CI 同此路径）
cd desktop
npm ci --ignore-scripts

# 3. 派生平台图标（.ico/.icns 从 1024 源图生成）
npx tauri icon src-tauri/icons/icon-source.png -o src-tauri/icons

# 4. 构建（产物在 desktop/src-tauri/target/release/bundle/）
npx tauri build

# 开发模式（热重载，先跑过第 1 步）
npx tauri dev
```

## CI 构建

`.github/workflows/desktop.yml`：手动触发或推 `v*` tag → 三平台构建 → artifacts 上传。
macOS 产物为 ad-hoc 签名（未加入 Apple 开发者计划），首次打开需右键 → 打开。

## 下载校验（SHA-256 + 构建来源证明）

tag 发布时，每个平台的安装包都附带一份 `SHA256SUMS-<平台>.txt`，且产物带有
GitHub 构建来源证明（artifact attestation，无自持签名密钥，由 GitHub 的
Sigstore 身份签发）。安装前建议校验：

```bash
# 1. 校验文件完整性（与安装包放在同一目录执行）
sha256sum -c SHA256SUMS-windows.txt        # Windows(Git Bash)/Linux 改对应文件名
shasum -a 256 -c SHA256SUMS-macos-arm64.txt # macOS

# 2. 验证构建来源（需 GitHub CLI 并登录）
gh attestation verify <安装包文件> --owner btc3149-bit
```

## 未签名安装包警告与绕过（三平台）

桌面安装包**未购买代码签名证书**：Windows 未签名、macOS 仅 ad-hoc 签名、
未做 Apple 公证。首次安装/打开时系统会报警，这是预期行为，按下面步骤绕过即可
（前提：安装包来自本仓库的 GitHub Release 且已通过上面的校验）：

- **Windows（SmartScreen）**：双击安装包后出现「Windows 已保护你的电脑」→
  点「更多信息」→「仍要运行」。
- **macOS（Gatekeeper）**：提示「无法打开，因为它来自身份不明的开发者」或
  「已损坏」→ 在 Finder 里右键（或 Control+点击）应用 →「打开」→ 再点「打开」；
  或终端执行 `xattr -dr com.apple.quarantine /Applications/jiamiliaotian.app`
  去除隔离属性。
- **Linux**：`.deb` 用 `sudo dpkg -i <文件>` 或软件中心安装，无签名拦截；
  `.AppImage` 需先 `chmod +x <文件>` 赋予执行权限再运行。

# 移动端脚手架 / Mobile (Tauri 2)

Tauri 2 同一代码库可出 Android/iOS。**注意：移动端构建无法在 CI 里完成签名/上架，需要本机 SDK。**

### 零配置开箱（v1.8.0 #20：构建期烤入默认服务器）

桌面/安卓壳不再要求用户手填服务器地址：打 tag 前在仓库 **Settings → Secrets and variables → Actions → Variables** 建 `JMLT_DEFAULT_SERVER_URL`（值如 `https://your-worker.workers.dev`），CI 构建时经 `JMLT_DEFAULT_SERVER` 注入并烤进产物——装上即连你的部署。规则：

- 仅接受 `https://` origin（消毒函数 `sanitizeBakedServerUrl`，任何可疑输入一律回退同源，绝不降级 http）
- 优先级：`?server=` 参数 > 应用内手动设置 > **烤入默认** > 同源——烤入值永远可被手动覆盖，不是锁定
- 它是仓库**变量（Variables）不是 secret**：地址会编译进分发的二进制里，本来就不是秘密
- 不设置该变量时，行为与旧版完全一致（手动填 / 同源）
- v1.8.1 起，官方部署作为代码级内置默认（`vite.config.js`）；设置 `JMLT_DEFAULT_SERVER_URL` 变量或本地 `JMLT_DEFAULT_SERVER` 环境变量即可覆盖
- v1.8.2：内置默认为 `https://chat.68626.us.ci`（自定义域）。原因：`*.workers.dev` 在部分地区遭 SNI 封锁（浏览器白屏转圈），自定义域可直连；workers.dev 地址仍同时有效

## Android

```bash
# 前置：Android Studio（SDK + NDK）、Rust、JDK 17；先在 desktop/ 下跑过
# 本地构建第 2 步（npm ci 装钉版 Tauri CLI），以下命令均在 desktop/ 下执行
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npx tauri android init   # 在 desktop/ 下生成 gen/android 工程
npm run build                       # web client（仓库根目录执行）
npx tauri android dev     # 真机调试
npx tauri android build   # 产出 APK/AAB（自动签名用 debug keystore；发布需自建 keystore）
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
npx tauri ios init
npm run build
npx tauri ios dev
npx tauri ios build
```

## 移动端安全提示

- WebView 内 localStorage/sessionStorage 随系统备份可能落盘——本地加密历史功能仍启用为佳（本来就密文）
- iOS 上 Web Push 需 16.4+ 且「添加到主屏幕」的 PWA 才支持；Tauri 壳内推送不可用，属已知边界
- 首次填服务器地址时确认是 `https://`（客户端已做校验并拒绝非 https）

// 加米辽田 desktop shell (Tauri 2).
//
// The window is a plain webview loading the BUNDLED web client (../dist).
// No native IPC features are enabled: all crypto lives in the web client,
// and the shell deliberately has zero privileged capabilities (RULES.md
// 第一准则：壳越小，攻击面越小). The user configures their own server URL
// in the app settings; nothing is hard-coded.
//
// 桌面壳只做一件事：把打包好的 web client 装进系统 WebView。不启用任何
// 原生 IPC 能力，加密全部在 web 层完成；服务器地址由用户在设置里填。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running jiamiliaotian desktop shell");
}

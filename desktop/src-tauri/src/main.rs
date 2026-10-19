// 加米辽田 desktop shell (Tauri 2) — thin bin wrapper over the shared lib.
// 桌面壳：共享库之上的薄 bin 入口。加密全在 web 层，见 lib.rs。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jiamiliaotian_lib::run()
}

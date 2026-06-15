// DaShengOS Tauri 2.x entry (Phase 5 收官 · 老板 item #4)
// 老板原则 #2: 0 行业务逻辑, 只做 window 包装
// 业务在 apps/web/, 这里只负责起 Tauri runtime

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running DaShengOS desktop");
}

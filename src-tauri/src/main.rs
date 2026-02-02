#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{MenuBuilder, SubmenuBuilder};

/// External server mode - Tauri acts as pure UI client.
/// User must run `bun run server` in terminal first.
/// This ensures proper shell environment for Claude Agent SDK auth.

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // App submenu (macOS shows this under the app name)
            let app_menu = SubmenuBuilder::new(app, "Fuxi")
                .text("about", "About Fuxi")
                .separator()
                .quit()
                .build()?;

            // Edit submenu with native clipboard operations
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // Window submenu
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}

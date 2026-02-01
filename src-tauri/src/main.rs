#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::MenuBuilder;

/// External server mode - Tauri acts as pure UI client.
/// User must run `bun run server` in terminal first.
/// This ensures proper shell environment for Claude Agent SDK auth.

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let menu = MenuBuilder::new(app)
                .text("about", "About Fuxi")
                .separator()
                .text("quit", "Quit")
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                app.exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}

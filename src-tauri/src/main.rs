#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::json;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Server process state managed across Tauri commands.
struct ServerState {
    child: Option<CommandChild>,
    running: bool,
    env_fixed: bool,
}

/// Returns environment diagnostics for debugging the auth chain.
/// Checks HOME, PATH, credentials file existence, and process info.
#[tauri::command]
fn get_env_diagnostics(state: tauri::State<'_, Mutex<ServerState>>) -> serde_json::Value {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    let cred_path = PathBuf::from(&home).join(".claude/.credentials.json");
    let env_fixed = state
        .lock()
        .map(|s| s.env_fixed)
        .unwrap_or(false);

    json!({
        "home": home,
        "path_first_dirs": path.split(':').take(5).collect::<Vec<_>>(),
        "path_has_bun": path.contains("bun"),
        "credentials_exist": cred_path.exists(),
        "credentials_path": cred_path.to_string_lossy(),
        "pid": std::process::id(),
        "env_fixed": env_fixed,
    })
}

/// Spawns the Bun server as a child process with the repaired environment.
/// Server output is piped to Tauri events for the frontend to consume.
#[tauri::command]
async fn start_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<ServerState>>,
) -> Result<serde_json::Value, String> {
    // Hold lock across check-and-spawn to prevent TOCTOU race.
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if s.running {
        return Ok(json!({
            "status": "already_running",
        }));
    }

    // Resolve project root from CWD.
    // NOTE: In production builds, this should use app.path().resource_dir()
    // since CWD for GUI-launched apps may be / or $HOME.
    let project_root = std::env::current_dir().unwrap_or_default();

    let (mut rx, child) = app
        .shell()
        .command("bun")
        .args(["run", "src/server/index.ts"])
        .current_dir(&project_root)
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {e}"))?;

    let pid = child.pid();
    s.child = Some(child);
    s.running = true;
    drop(s); // Release lock before spawning the async listener task

    // Stream server stdout/stderr as Tauri events.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let _ = app_handle.emit("server-stdout", text.to_string());
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let _ = app_handle.emit("server-stderr", text.to_string());
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_handle.emit(
                        "server-terminated",
                        json!({
                            "code": payload.code,
                            "signal": payload.signal,
                        }),
                    );
                    // Update state via AppHandle (which is 'static).
                    // Recover from poisoned mutex to avoid permanent deadlock.
                    let managed: tauri::State<'_, Mutex<ServerState>> =
                        app_handle.state();
                    let lock_result = managed.lock();
                    let mut guard = match lock_result {
                        Ok(g) => g,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    guard.running = false;
                    guard.child = None;
                }
                _ => {}
            }
        }
    });

    Ok(json!({
        "status": "started",
        "pid": pid,
        "project_root": project_root.to_string_lossy(),
    }))
}

/// Stops the running server process using the shell plugin's kill method.
#[tauri::command]
fn stop_server(state: tauri::State<'_, Mutex<ServerState>>) -> Result<serde_json::Value, String> {
    let mut s = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if !s.running {
        return Ok(json!({ "status": "not_running" }));
    }

    if let Some(child) = s.child.take() {
        let pid = child.pid();
        child.kill().map_err(|e| format!("Failed to kill server: {e}"))?;
        s.running = false;
        Ok(json!({ "status": "stopped", "pid": pid }))
    } else {
        s.running = false;
        Ok(json!({ "status": "no_child" }))
    }
}

fn main() {
    // FIX: Repair environment for GUI apps launched from Finder/Dock.
    // Sources ~/.zshrc / ~/.bash_profile to get proper HOME, PATH, etc.
    // This is critical for Claude Agent SDK auth (needs HOME for credentials)
    // and for finding the `bun` binary on PATH.
    let env_fixed = match fix_path_env::fix_all_vars() {
        Ok(()) => true,
        Err(e) => {
            eprintln!("[fix-path-env] Failed to fix env vars: {e}");
            // Continue anyway — terminal-launched apps already have correct env
            false
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(ServerState {
            child: None,
            running: false,
            env_fixed,
        }))
        .invoke_handler(tauri::generate_handler![
            get_env_diagnostics,
            start_server,
            stop_server,
        ])
        .setup(|app| {
            let app_menu = SubmenuBuilder::new(app, "Workforce")
                .text("about", "About Workforce")
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

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
        .run(|app, event| {
            // Kill the server process when the app exits to prevent orphans.
            if let RunEvent::Exit = event {
                let state: tauri::State<'_, Mutex<ServerState>> = app.state();
                let lock_result = state.lock();
                if let Ok(mut s) = lock_result {
                    if let Some(child) = s.child.take() {
                        let _ = child.kill();
                    }
                    s.running = false;
                }
            }
        });
}

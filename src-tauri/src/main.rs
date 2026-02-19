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
    /// PID of the currently active child, used to guard against stale
    /// termination events from a previously killed process.
    active_pid: Option<u32>,
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
        "path_first_dirs": std::env::split_paths(&path)
            .take(5)
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
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
    // Quick check under short lock — avoids holding the lock during command
    // construction and spawn(). A second acquire after spawn() guards against
    // a concurrent start_server() that won the race (TOCTOU prevention).
    // Note: unlike stop_server/Exit, we propagate mutex poison here rather
    // than recovering, since spawning into inconsistent state is unsafe.
    {
        let s = state.lock().map_err(|e| e.to_string())?;
        if s.running {
            return Ok(json!({ "status": "already_running" }));
        }
    }

    // Build command outside the lock (no shared state needed here).
    // Dev: run TypeScript source via Bun from the compile-time project root.
    //   env!("CARGO_MANIFEST_DIR") is resolved at compile time to src-tauri/,
    //   so the parent is always the repo root regardless of runtime CWD.
    // Production: run the standalone compiled server binary via Tauri sidecar.
    //   `bun build --compile` embeds the Bun runtime, so no external Bun needed.
    //   The binary is bundled via externalBin in tauri.bundle.conf.json.
    let (server_dir, command) = if cfg!(debug_assertions) {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .canonicalize()
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
        let cmd = app
            .shell()
            .command("bun")
            .args(["run", "src/server/index.ts"])
            .current_dir(&project_root);
        (project_root, cmd)
    } else {
        let cmd = app
            .shell()
            .sidecar("server")
            .map_err(|e| format!("Cannot resolve server sidecar: {e}"))?;
        let dir = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        (dir, cmd)
    };

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {e}"))?;

    // Re-acquire lock for state update. Double-check guards against a
    // concurrent start_server call that won the race while we spawned.
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if s.running {
        // Another call won the race — kill the duplicate we just spawned.
        let dup_pid = child.pid();
        if let Err(e) = child.kill() {
            eprintln!("[start_server] Failed to kill duplicate process (PID {dup_pid}): {e}");
        }
        return Ok(json!({ "status": "already_running" }));
    }

    let spawned_pid = child.pid();
    s.child = Some(child);
    s.running = true;
    s.active_pid = Some(spawned_pid);
    drop(s); // Release lock before spawning the async listener task

    // Stream server stdout/stderr as Tauri events.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if let Err(e) = app_handle.emit("server-stdout", text.to_string()) {
                        eprintln!("[server-stdout] Failed to emit: {e}");
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if let Err(e) = app_handle.emit("server-stderr", text.to_string()) {
                        eprintln!("[server-stderr] Failed to emit: {e}");
                    }
                }
                CommandEvent::Terminated(payload) => {
                    // Update state via AppHandle (which is 'static).
                    // Recover from poisoned mutex to avoid permanent deadlock.
                    let managed: tauri::State<'_, Mutex<ServerState>> =
                        app_handle.state();
                    let lock_result = managed.lock();
                    let mut guard = match lock_result {
                        Ok(g) => g,
                        Err(poisoned) => {
                            eprintln!("[Terminated] Recovering from poisoned ServerState mutex");
                            poisoned.into_inner()
                        }
                    };
                    // Only clear state and emit event if this termination
                    // belongs to the currently active child. A rapid
                    // stop→start cycle may have already replaced the child
                    // with a new process — silently drop stale events.
                    if guard.active_pid == Some(spawned_pid) {
                        guard.running = false;
                        guard.child = None;
                        guard.active_pid = None;
                        if let Err(e) = app_handle.emit(
                            "server-terminated",
                            json!({
                                "code": payload.code,
                                "signal": payload.signal,
                            }),
                        ) {
                            eprintln!("[Terminated] Failed to emit server-terminated event: {e}");
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(json!({
        "status": "started",
        "pid": spawned_pid,
        "server_dir": server_dir.to_string_lossy(),
    }))
}

/// Stops the running server process using the shell plugin's kill method.
#[tauri::command]
fn stop_server(state: tauri::State<'_, Mutex<ServerState>>) -> Result<serde_json::Value, String> {
    let mut s = match state.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            eprintln!("[stop_server] Recovering from poisoned ServerState mutex");
            poisoned.into_inner()
        }
    };

    if !s.running {
        return Ok(json!({ "status": "not_running" }));
    }

    // take() moves the CommandChild out of the Option, consuming ownership.
    // kill(self) consumes the child — the handle cannot be reused after this
    // regardless of whether kill succeeds, so state must be cleared.
    // Return Ok with optional kill_error rather than Err, since state is
    // already irrecoverably cleared and a retry would see "not_running".
    if let Some(child) = s.child.take() {
        let pid = child.pid();
        let kill_error = child.kill().err().map(|e| e.to_string());
        if let Some(ref err) = kill_error {
            eprintln!("[stop_server] kill failed for PID {pid}: {err}");
        }
        s.running = false;
        s.active_pid = None;
        Ok(json!({ "status": "stopped", "pid": pid, "kill_error": kill_error }))
    } else {
        s.running = false;
        s.active_pid = None;
        Ok(json!({ "status": "no_child" }))
    }
}

fn main() {
    // FIX: Repair environment for GUI apps launched from Finder/Dock.
    // Spawns user's login shell to capture HOME, PATH, etc.
    // Critical for Claude Agent SDK auth (needs HOME for credentials)
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(ServerState {
            child: None,
            running: false,
            env_fixed,
            active_pid: None,
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
            // Recover from poisoned mutex — this is the last chance to clean up.
            if let RunEvent::Exit = event {
                let state: tauri::State<'_, Mutex<ServerState>> = app.state();
                let mut s = match state.lock() {
                    Ok(g) => g,
                    Err(poisoned) => {
                        eprintln!("[Exit] Recovering from poisoned ServerState mutex");
                        poisoned.into_inner()
                    }
                };
                if let Some(child) = s.child.take() {
                    if let Err(e) = child.kill() {
                        eprintln!("[Exit] Failed to kill server process: {e}");
                    }
                }
                s.running = false;
                s.active_pid = None;
            }
        });
}

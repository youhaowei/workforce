use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod sidecar;

/// Native directory picker — equivalent of Electron's dialog.showOpenDialog.
#[tauri::command]
async fn open_directory(
    app: AppHandle,
    starting_folder: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(folder) = starting_folder {
        builder = builder.set_directory(folder);
    }
    let result = builder.blocking_pick_folder();
    Ok(result.map(|p| p.to_string()))
}

/// Open a URL in the system default browser.
#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Return the actual port the Bun sidecar bound to.
/// The frontend calls this at startup to resolve the API base URL dynamically,
/// so port scanning in the server never silently breaks the connection.
#[tauri::command]
fn get_server_port(port: tauri::State<'_, ServerPort>) -> u16 {
    port.0
}

/// Shared state holding the resolved server port, set once after health-check succeeds.
struct ServerPort(u16);

/// Repair PATH for GUI-launched apps on macOS.
/// Without this, the agent SDK can't find `claude` CLI in production.
fn repair_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = std::process::Command::new(&shell)
        .args(["-l", "-c", "printf %s \"$PATH\""])
        .output()
    {
        if let Ok(shell_path) = String::from_utf8(output.stdout) {
            if !shell_path.is_empty() {
                let current = std::env::var("PATH").unwrap_or_default();
                std::env::set_var("PATH", format!("{}:{}", shell_path, current));
            }
        }
    }
}

/// Resolve the .dev-port file path relative to the project/resource root.
/// The server writes this file on startup with its actual bound port.
fn dev_port_file(app: &tauri::App) -> PathBuf {
    // In dev, resource_dir() points to the project root; in production bundles
    // it points to the app resources directory — both are where the server runs.
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
        .join(".dev-port")
}

pub fn run() {
    // Repair PATH before anything else
    repair_path();

    let sidecar_child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> =
        Arc::new(Mutex::new(None));
    let sidecar_for_exit = sidecar_child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_directory, open_external, get_server_port])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Apply macOS vibrancy (frosted glass under window).
            // Traffic light position is set via trafficLightPosition in tauri.conf.json.
            let window = app.get_webview_window("main").unwrap();
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::UnderWindowBackground,
                    None,
                    None,
                )
                .expect("Failed to apply vibrancy");
            }

            // Spawn Bun sidecar — no PORT env var; the server picks its own port
            // (starting from DEFAULT_SERVER_PORT in src/shared/ports.ts) and writes
            // the actual port to .dev-port for discovery.
            let child = sidecar::spawn_server(&handle)?;
            *sidecar_child.lock().unwrap() = Some(child);

            // Discover port from .dev-port, wait for health, expose port as state, show window.
            let port_file = dev_port_file(app);
            let win = window.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let timeout = Duration::from_secs(30);
                match sidecar::discover_port(&port_file, timeout).await {
                    Ok(port) => {
                        eprintln!("[tauri] Server bound on port {}", port);
                        // Register the port so the frontend can query it via get_server_port.
                        app_handle.manage(ServerPort(port));
                        match sidecar::wait_for_health(port, timeout).await {
                            Ok(()) => {
                                eprintln!("[tauri] Server is healthy on port {}", port);
                                let _ = win.show();
                            }
                            Err(e) => {
                                eprintln!("[tauri] Server health check failed: {}", e);
                                let _ = win.show();
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[tauri] Port discovery failed: {}", e);
                        let _ = win.show();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Ok(mut guard) = sidecar_for_exit.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

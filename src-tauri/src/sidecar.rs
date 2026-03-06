use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// Spawn the Bun sidecar process running the Hono server.
/// No PORT env var is set — the server chooses its own port (starting from
/// DEFAULT_SERVER_PORT in src/shared/ports.ts) and writes it to .dev-port.
pub fn spawn_server(app: &AppHandle) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let (mut rx, child) = app
        .shell()
        .sidecar("bun")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["run", "src/server/index.ts"])
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Log sidecar output in background
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    eprintln!("[bun:stdout] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[bun:stderr] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!(
                        "[bun] Process terminated with code {:?}, signal {:?}",
                        payload.code, payload.signal
                    );
                    break;
                }
                CommandEvent::Error(err) => {
                    eprintln!("[bun:error] {}", err);
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Poll the .dev-port file written by the server on startup to discover which
/// port it actually bound to. Returns the port once the file exists and is valid.
pub async fn discover_port(
    port_file: &std::path::Path,
    timeout: Duration,
) -> Result<u16, String> {
    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        if tokio::time::Instant::now() > deadline {
            return Err(format!(
                "Server did not write port file at {} within {}s",
                port_file.display(),
                timeout.as_secs()
            ));
        }

        if let Ok(content) = std::fs::read_to_string(port_file) {
            if let Ok(port) = content.trim().parse::<u16>() {
                return Ok(port);
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Poll the server's /health endpoint until it responds 200.
pub async fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
    let url = format!("http://localhost:{}/health", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        if tokio::time::Instant::now() > deadline {
            return Err(format!(
                "Server failed to become healthy within {}s",
                timeout.as_secs()
            ));
        }

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

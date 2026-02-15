fn main() {
    // Ensure dist-server/server.js exists so tauri.conf.json's
    // bundle.resources validation passes during dev builds and
    // cargo check. The real bundle is produced by `bun run build:server`
    // (run via beforeBuildCommand) and overwrites this stub.
    let stub = std::path::Path::new("../dist-server/server.js");
    if !stub.exists() {
        let _ = std::fs::create_dir_all("../dist-server");
        let _ = std::fs::write(
            stub,
            "throw new Error('Server bundle not built. Run: bun run build:server');\n",
        );
    }

    tauri_build::build()
}

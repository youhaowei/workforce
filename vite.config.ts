import {defineConfig, type Plugin} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {resolve} from "path";
import {readFileSync, writeFileSync, unlinkSync} from "fs";
import {DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT} from "./src/shared/ports";

/** Read the server's actual port from .dev-port (written by server on startup). */
function discoverApiPort(): string | undefined {
    try {
        return readFileSync(resolve(__dirname, ".dev-port"), "utf-8").trim();
    } catch {
        return undefined;
    }
}

const VITE_PORT_FILE = resolve(__dirname, ".vite-port");

/** Write .vite-port on dev server start so consumers can discover the Vite port. */
function vitePortFile(): Plugin {
    return {
        name: "vite-port-file",
        configureServer(server) {
            server.httpServer?.once("listening", () => {
                const addr = server.httpServer!.address();
                if (addr && typeof addr === "object") {
                    writeFileSync(VITE_PORT_FILE, String(addr.port));
                }
            });
            const cleanup = () => {
                try {
                    unlinkSync(VITE_PORT_FILE);
                } catch {
                    /* not found */
                }
            };
            server.httpServer?.on("close", cleanup);
        },
        buildEnd() {
            try {
                unlinkSync(VITE_PORT_FILE);
            } catch {
                /* not found */
            }
        },
    };
}

// Tauri injects TAURI_DEV_HOST for mobile dev; on desktop devUrl in tauri.conf.json
// handles the connection. Vite's host config adapts for both.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({command}) => ({
    plugins: [react(), tailwindcss(), vitePortFile()],
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },
    // Prevent vite from obscuring Rust errors
    clearScreen: false,
    server: {
        port: DEFAULT_VITE_PORT,
        strictPort: true,
        host: host || false,
        hmr: host ? {protocol: "ws", host, port: DEFAULT_VITE_PORT + 1} : undefined,
        watch: {
            // Tell vite to ignore watching src-tauri
            ignored: ["**/src-tauri/**"],
        },
    },
    define: {
        // Always inject VITE_API_PORT so the UI finds the API server.
        // Dev: read from .dev-port (written by server on startup) or fall back to default.
        // Production build: bake in the default port (Tauri sidecar always uses this).
        "import.meta.env.VITE_API_PORT": JSON.stringify(
            process.env.VITE_API_PORT ||
            (command === "serve" ? discoverApiPort() : undefined) ||
            String(DEFAULT_SERVER_PORT),
        ),
    },
    build: {
        target: "ES2020",
        minify: "esbuild",
        sourcemap: false,
    },
}));

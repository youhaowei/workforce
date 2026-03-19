import {defineConfig, type Plugin} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {TanStackRouterVite} from "@tanstack/router-plugin/vite";
import {visualizer} from "rollup-plugin-visualizer";
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
    plugins: [
        TanStackRouterVite({
            routesDirectory: "./src/ui/routes",
            generatedRouteTree: "./src/ui/routeTree.gen.ts",
        }), // Must be before react()
        react(),
        tailwindcss(),
        vitePortFile(),
        visualizer({
            open: false, // Don't auto-open (can be noisy during dev)
            gzipSize: true,
            brotliSize: true,
            filename: "dist/stats.html",
        }),
    ],
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
            "tracey": resolve(__dirname, "lib/tracey/src"),
            "unifai": resolve(__dirname, "lib/unifai/src"),
            "@wystack/types": resolve(__dirname, "lib/wystack/packages/types/src"),
            "@wystack/version": resolve(__dirname, "lib/wystack/packages/version/src"),
            "@wystack/db": resolve(__dirname, "lib/wystack/packages/db/src"),
            "@wystack/server": resolve(__dirname, "lib/wystack/packages/server/src"),
            "@wystack/client": resolve(__dirname, "lib/wystack/packages/client/src"),
            "@wystack/start": resolve(__dirname, "lib/wystack/packages/start/src"),
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
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules")) {
                        // React core
                        if (id.includes("react") || id.includes("react-dom")) {
                            return "react-vendor";
                        }
                        // Icons
                        if (id.includes("lucide-react")) {
                            return "icons";
                        }
                        // Data layer
                        if (id.includes("@trpc") || id.includes("@tanstack/react-query")) {
                            return "data-vendor";
                        }
                        // Router
                        if (id.includes("@tanstack/react-router")) {
                            return "router";
                        }
                        // UI primitives
                        if (id.includes("radix-ui")) {
                            return "ui-vendor";
                        }
                        // Everything else
                        return "vendor";
                    }
                },
            },
        },
    },
}));

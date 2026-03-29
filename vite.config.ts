import {defineConfig, type Plugin} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {TanStackRouterVite} from "@tanstack/router-plugin/vite";
import {visualizer} from "rollup-plugin-visualizer";
import {resolve} from "path";
import {sharedAliases} from "./vite.shared";
import {readFileSync, writeFileSync, unlinkSync} from "fs";
import {execFileSync} from "child_process";
import {DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT} from "./src/shared/ports";

/** Read current git branch name (best-effort, returns undefined on failure). */
function discoverGitBranch(): string | undefined {
    try {
        return execFileSync("git", ["branch", "--show-current"], { encoding: "utf-8" }).trim() || undefined;
    } catch {
        return undefined;
    }
}

/** Read the server's actual port from .dev-port (written by server on startup). */
function discoverApiPort(): string | undefined {
    try {
        return readFileSync(resolve(__dirname, ".dev-port"), "utf-8").trim();
    } catch {
        return undefined;
    }
}

const VITE_PORT_FILE = resolve(__dirname, ".vite-port");

/** Write .vite-port on dev server start so consumers can discover the Vite port.
 *  launch.json uses autoPort for preview_start — no need to mutate it at runtime. */
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

export default defineConfig(({command}) => ({
    // Relative base for Electron file:// and server-served production builds
    base: './',
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
        alias: sharedAliases(__dirname),
    },
    // Prevent vite from obscuring Rust errors
    clearScreen: false,
    server: {
        port: parseInt(process.env.VITE_PORT || String(DEFAULT_VITE_PORT)),
        strictPort: false,
        watch: {
            ignored: ["**/src-tauri/**", "**/src-electron/**"],
        },
    },
    define: {
        // Always inject VITE_API_PORT so the UI finds the API server.
        // Dev: read from .dev-port (written by server on startup) or fall back to default.
        // Production build: bake in the default port (Electron in-process server uses this).
        "import.meta.env.VITE_API_PORT": JSON.stringify(
            process.env.VITE_API_PORT ||
            (command === "serve" ? discoverApiPort() : undefined) ||
            String(DEFAULT_SERVER_PORT),
        ),
        // Dev-only: inject git branch for multi-instance identification in document.title.
        "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(
            command === "serve" ? discoverGitBranch() : undefined,
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

import {defineConfig, type Plugin} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {TanStackRouterVite} from "@tanstack/router-plugin/vite";
import {visualizer} from "rollup-plugin-visualizer";
import {resolve} from "path";
import {readFileSync, writeFileSync, unlinkSync} from "fs";
import {execFileSync} from "child_process";
import {DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT} from "./src/shared/ports";
import {createPathAliases} from "./tooling/path-aliases";

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

const host = process.env.DEV_HOST;

export default defineConfig(({command}) => ({
    base: "./",
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
        alias: createPathAliases(__dirname),
    },
    // Prevent vite from obscuring Rust errors
    clearScreen: false,
    server: {
        port: parseInt(process.env.VITE_PORT || String(DEFAULT_VITE_PORT), 10),
        strictPort: false,
        host: host || false,
        hmr: host ? {protocol: "ws", host, port: parseInt(process.env.VITE_PORT || String(DEFAULT_VITE_PORT), 10) + 1} : undefined,
        watch: {
            ignored: ["**/src-electron/**"],
        },
    },
    define: {
        // Always inject VITE_API_PORT so the UI finds the API server.
        // Dev: read from .dev-port (written by server on startup) or fall back to default.
        // Production: Electron main process overrides via preload bridge.
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
        // Use Vite/Rollup's default chunk graph. The previous manual vendor split
        // introduced a react-vendor <-> vendor cycle that only surfaced at runtime
        // in the packaged Electron build.
    },
}));

import {Hono} from "hono";
import {cors} from "hono/cors";
import {existsSync, readFileSync, writeFileSync, unlinkSync} from "fs";
import {createServer} from "net";
import {homedir} from "os";
import {join, dirname, resolve} from "path";
import {fileURLToPath} from "url";
import {createLogger, initTracey, getRecentLogs} from "tracey";
import {getAgentService} from "@/services/agent";

/** Runtime detection — true when running under Bun, false for Node/tsx/Electron. */
const IS_BUN = typeof globalThis.Bun !== "undefined";
import {DEFAULT_SERVER_PORT} from "@/shared/ports";
import {getDataDir} from "@/services/data-dir";

initTracey({
    file: {dir: join(getDataDir(), "logs"), prefix: "workforce", flushOnCrash: true},
    ringBuffer: 1000,
});

const log = createLogger('Server');
import {appRouter} from "./routers";
import {trpcServer} from "@hono/trpc-server";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Eagerly create the AgentService singleton at module-load time so the Claude
// SDK subprocess and model cache begin loading as early as possible — well
// before the HTTP server is bound or the first UI request arrives.
getAgentService();

/**
 * Log auth-related diagnostics on server startup.
 * Helps debug auth issues in desktop or standalone mode.
 */
function logAuthDiagnostics() {
    const home = process.env.HOME || homedir();
    const credPath = `${home}/.claude/.credentials.json`;

    log.info({
        cwd: process.cwd(),
        home,
        credentialsExist: existsSync(credPath),
        anthropicApiKeySet: !!process.env.ANTHROPIC_API_KEY,
        anthropicAuthTokenSet: !!process.env.ANTHROPIC_AUTH_TOKEN,
        pid: process.pid,
        ppid: process.ppid,
    }, "Auth diagnostics");
}

export const app = new Hono();

// Trusted-local threat model: server binds to localhost, only the local
// desktop webview (or dev browser on localhost) should access it.
const ALLOWED_ORIGINS = new Set(["localhost", "127.0.0.1"]);

app.use(
    "*",
    cors({
        origin: (origin) => {
            if (!origin) return origin as string; // same-origin / non-browser
            try {
                const url = new URL(origin);
                if (ALLOWED_ORIGINS.has(url.hostname)) return origin;
            } catch {
                /* invalid origin */
            }
            return undefined as unknown as string; // reject — no ACAO header
        },
    }),
);

// tRPC endpoint — all routers available at /api/trpc/*
app.use("/api/trpc/*", trpcServer({router: appRouter}));

// Health check — also polled by Tauri Rust process at startup
app.get("/health", (c) => c.json({ok: true}));

app.get("/debug-log", async (c) => {
    const entries = getRecentLogs().slice(-200);
    const lines = entries.map((e) => {
        const time = new Date(e.time).toISOString();
        const component = e.component ? `[${e.component}]` : "";
        return `[${time}] ${component} ${e.msg}`;
    });
    return c.text(lines.join("\n"));
});

/**
 * Check auth configuration without making an API call.
 * Returns diagnostic info about available auth sources.
 *
 * NOTE: The SDK subprocess handles token refresh internally.
 * Even if the stored token is expired, the SDK will refresh it.
 */
app.get("/auth-check", async (c) => {
    const home = process.env.HOME || homedir();
    const credPath = `${home}/.claude/.credentials.json`;

    const result: {
        hasCredentialsFile: boolean;
        hasApiKey: boolean;
        hasAuthToken: boolean;
        credentialsFileReadable: boolean;
        tokenExpired?: boolean;
        hasRefreshToken?: boolean;
        credentialsError?: string;
        home: string;
        cwd: string;
        pid: number;
        ppid: number;
        note?: string;
    } = {
        hasCredentialsFile: existsSync(credPath),
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        hasAuthToken: !!process.env.ANTHROPIC_AUTH_TOKEN,
        credentialsFileReadable: false,
        home,
        cwd: process.cwd(),
        pid: process.pid,
        ppid: process.ppid,
    };

    // Try to read and parse credentials file
    if (result.hasCredentialsFile) {
        try {
            const content = readFileSync(credPath, "utf-8");
            const creds = JSON.parse(content);
            result.credentialsFileReadable = true;

            // Check OAuth token status
            if (creds.claudeAiOauth) {
                result.hasRefreshToken = !!creds.claudeAiOauth.refreshToken;
                if (creds.claudeAiOauth.expiresAt) {
                    result.tokenExpired = creds.claudeAiOauth.expiresAt < Date.now();
                }
            }
        } catch (err) {
            result.credentialsError = err instanceof Error ? err.message : String(err);
        }
    }

    // SDK handles token refresh, so credentials file is sufficient
    const hasAnyAuth = result.hasCredentialsFile || result.hasApiKey || result.hasAuthToken;

    if (result.tokenExpired && result.hasRefreshToken) {
        result.note = "Token expired but refresh token available - SDK will refresh automatically";
    }

    return c.json({authenticated: hasAnyAuth, ...result}, hasAnyAuth ? 200 : 401);
});

// Serve Vite build output in production (same-origin, no CORS needed).
// In dev standalone or Tauri sidecar: __dirname = <project>/src/server/ → ../../dist
// NOTE: Dynamic imports are deferred to setupStaticServing() to avoid top-level await,
// which conflicts with Node's module format detection when submodules use require().
const distCandidates = [join(__dirname, "../dist"), join(__dirname, "../../dist")];
const distPath = distCandidates.find((p) => existsSync(p));

async function setupStaticServing() {
    if (!distPath) return;
    if (IS_BUN) {
        const {serveStatic} = await import("hono/bun");
        app.use("*", serveStatic({root: distPath}));
    } else {
        const {serveStatic} = await import("@hono/node-server/serve-static");
        app.use("*", serveStatic({root: distPath}));
    }
    // SPA fallback: serve index.html for non-API paths that don't match a static file
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
        const indexHtml = readFileSync(indexPath, "utf-8");
        app.get("*", (c) => c.html(indexHtml));
    }
}

const DEV_PORT_FILE = join(process.cwd(), ".dev-port");

/** Probe whether a port is available by briefly binding and closing a TCP server. */
function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const srv = createServer();
        srv.once("error", () => resolve(false));
        srv.listen(port, "localhost", () => {
            srv.close(() => resolve(true));
        });
    });
}

const MAX_PORT_RETRIES = 10;

export async function startServer(overrides?: {port?: number}): Promise<{port: number}> {
    await setupStaticServing();
    const basePort = overrides?.port ?? parseInt(process.env.PORT || String(DEFAULT_SERVER_PORT));

    // Find an available port starting from basePort
    let port = basePort;
    for (let i = 0; i <= MAX_PORT_RETRIES; i++) {
        const candidate = basePort + i;
        if (await isPortAvailable(candidate)) {
            port = candidate;
            break;
        }
        if (i < MAX_PORT_RETRIES) {
            log.info(`Port ${candidate} in use, trying ${candidate + 1}`);
        } else {
            throw new Error(`All ports ${basePort}–${basePort + MAX_PORT_RETRIES} are in use`);
        }
    }

    if (IS_BUN) {
        Bun.serve({
            fetch: app.fetch,
            port,
            hostname: "localhost",
            // SSE connections are long-lived; allow up to 2 min idle
            idleTimeout: 120,
        });
    } else {
        const {serve} = await import("@hono/node-server");
        serve({fetch: app.fetch, port, hostname: "localhost"});
    }

    // IPC: notify parent process (Electron main) that we're ready
    if (process.send) {
        process.send({type: "server-ready", port});
    }

    // Write actual port so vite can discover it
    if (isMainModule) {
        writeFileSync(DEV_PORT_FILE, String(port));
        process.on("exit", () => {
            try {
                unlinkSync(DEV_PORT_FILE);
            } catch {
                /* cleanup best-effort */
            }
        });
        process.on("SIGINT", () => process.exit(0));
        process.on("SIGTERM", () => process.exit(0));
    }

    logAuthDiagnostics();
    log.info(`Workforce server running on http://localhost:${port}`);

    // Warm up model list cache eagerly so it's ready before the first query.
    getAgentService()
        .getSupportedModels()
        .then(
            (models) => log.info(`Model cache warmed: ${models.length} models`),
            (err) =>
                log.warn({ error: err instanceof Error ? err.message : String(err) }, "Model cache warm-up failed (will retry on demand)"),
        );

    return {port};
}

// Standalone mode (bun run src/server/index.ts)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) startServer();

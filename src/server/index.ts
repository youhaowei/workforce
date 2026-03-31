import {Hono} from "hono";
import {cors} from "hono/cors";
import {serve, type ServerType} from "@hono/node-server";
import {serveStatic} from "@hono/node-server/serve-static";
import {existsSync, readFileSync, writeFileSync, unlinkSync} from "fs";
import {homedir} from "os";
import {join, dirname, resolve} from "path";
import {fileURLToPath} from "url";
import {createLogger, initTracey, getRecentLogs} from "tracey";
import {getAgentService} from "@/services/agent";
import {DEFAULT_SERVER_PORT} from "@/shared/ports";
import {bindWithRetry, parsePort} from "@/shared/port-utils";
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

// Health check — polled by SetupGate and Electron main process at startup
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
function setupStaticServingFromDir(distPath: string) {
    if (!existsSync(distPath)) return;

    app.use("*", serveStatic({root: distPath}));
    // SPA fallback: serve index.html for non-API paths that don't match a static file
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
        const indexHtml = readFileSync(indexPath, "utf-8");
        app.get("*", (c) => c.html(indexHtml));
    }
}

// Standalone mode heuristic: try relative paths from server's __dirname.
// Electron production passes explicit staticDir via startServer() instead.
function setupStaticServing() {
    const distCandidates = [
        join(__dirname, "../dist"),
        join(__dirname, "../../dist"),
    ];
    const distPath = distCandidates.find((p) => existsSync(p));
    if (distPath) setupStaticServingFromDir(distPath);
}

const DEV_PORT_FILE = join(process.cwd(), ".dev-port");
const MAX_PORT_RETRIES = 10;

// Standalone mode (`bun run server`) — detected before startServer so both
// the function body and the top-level call site can reference it.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

// Only register heuristic static serving in standalone mode.
// Electron production passes explicit staticDir via startServer() instead.
if (isMainModule) setupStaticServing();

export async function startServer(overrides?: {port?: number; staticDir?: string}): Promise<{port: number; server: ServerType}> {
    // Set up static serving before binding — uses explicit staticDir if provided,
    // otherwise falls back to heuristic path discovery (standalone server mode).
    if (overrides?.staticDir) {
        setupStaticServingFromDir(overrides.staticDir);
    }

    const basePort = overrides?.port ?? parsePort(process.env.PORT, DEFAULT_SERVER_PORT);

    // Bind-to-discover: attempt listen on candidate port, catch EADDRINUSE, retry.
    // Eliminates the TOCTOU gap of the previous probe-then-bind approach.
    const { server: httpServer, port } = await bindWithRetry<ServerType & { keepAliveTimeout?: number; headersTimeout?: number }>(
        basePort,
        MAX_PORT_RETRIES,
        (candidate) => serve({
            fetch: app.fetch,
            port: candidate,
            hostname: "localhost",
        }) as ServerType & { keepAliveTimeout?: number; headersTimeout?: number },
        (tried, next) => log.info(`Port ${tried} in use, trying ${next}`),
    );

    // SSE connections are long-lived; allow up to 2 min idle (Node defaults to 5s)
    httpServer.keepAliveTimeout = 120_000;
    httpServer.headersTimeout = 125_000;

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

    return {port, server: httpServer};
}

if (isMainModule) startServer();

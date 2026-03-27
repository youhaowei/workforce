/**
 * Electron main process.
 *
 * Responsibilities:
 *  1. Spawn the backend server as a Node child process (fork).
 *  2. Wait for the server to report its port via IPC.
 *  3. Create the BrowserWindow pointing at the Vite dev server (dev) or bundled dist (prod).
 *  4. Expose native capabilities via IPC handlers (file dialog, open URL).
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type BrowserWindowConstructorOptions,
} from "electron";
import { execFileSync, fork, spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IS_DEV = process.env.ELECTRON_FORCE_PROD ? false : !app.isPackaged;
const DEFAULT_SERVER_PORT = 19675;
const DEFAULT_VITE_PORT = 19676;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 250;

// ---------------------------------------------------------------------------
// PATH repair — GUI-launched apps on macOS often have a minimal PATH.
// Source the user's shell profile so tools like `bun`, `node`, etc. are found.
// ---------------------------------------------------------------------------

function repairPath() {
  if (process.platform !== "darwin") return;
  try {
    const shellPath = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shellPath, ["-ilc", "echo $PATH"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (out) process.env.PATH = out;
  } catch {
    // Non-critical — keep existing PATH
  }
}

// ---------------------------------------------------------------------------
// Server child process
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;
let serverPort: number = DEFAULT_SERVER_PORT;

function getServerEntry(): string {
  if (IS_DEV) {
    // In dev, tsx runs the TS source directly
    return join(__dirname, "../src/server/index.ts");
  }
  // In production, dist-server is asarUnpack'd — fork() needs the real filesystem path.
  // __dirname is inside app.asar/dist-electron/, so ../dist-server/ resolves inside the asar.
  // Replace "app.asar" with "app.asar.unpacked" to get the extracted path.
  const asarPath = join(__dirname, "../dist-server/index.mjs");
  return asarPath.replace("app.asar", "app.asar.unpacked");
}

function spawnServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const entry = getServerEntry();
    const timeout = setTimeout(
      () => reject(new Error("Server did not report port within 30s")),
      HEALTH_TIMEOUT_MS,
    );

    if (IS_DEV) {
      // Dev: use tsx to run TypeScript directly with tsconfig-paths for alias resolution
      const tsxBin = join(__dirname, "../node_modules/.bin/tsx");
      serverProcess = spawn(
        tsxBin,
        ["--tsconfig", "tsconfig.json", entry],
        {
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          env: {
            ...process.env,
            ELECTRON_MODE: "1",
            NODE_ENV: "development",
            // Allow require() in ESM — tracey submodule uses require("fs") in ESM context
            NODE_OPTIONS: "--experimental-require-module",
          },
          cwd: join(__dirname, ".."),
        },
      );
    } else {
      // Prod: fork the compiled server as a plain Node process
      serverProcess = fork(entry, [], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ELECTRON_MODE: "1",
          NODE_ENV: "production",
        },
      });
    }

    serverProcess!.stdout?.on("data", (data: Buffer) => {
      console.log(`[server] ${data.toString().trimEnd()}`);
    });

    serverProcess!.stderr?.on("data", (data: Buffer) => {
      console.error(`[server] ${data.toString().trimEnd()}`);
    });

    serverProcess!.on("message", (msg: any) => {
      if (msg?.type === "server-ready" && typeof msg.port === "number") {
        clearTimeout(timeout);
        serverPort = msg.port;
        resolve(msg.port);
      }
    });

    serverProcess!.on("exit", (code) => {
      console.log(`[server] exited with code ${code}`);
      serverProcess = null;
    });

    serverProcess!.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Health check — wait for HTTP 200 on /health
// ---------------------------------------------------------------------------

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const url = `http://localhost:${port}/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(`Server health check timed out on port ${port}`);
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createWindow(port: number) {
  const windowOpts: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    show: false, // Show after content is ready
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 8, y: 22 },
    transparent: true,
    vibrancy: "under-window",
    webPreferences: {
      preload: join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Needed for preload to use Node APIs
    },
  };

  mainWindow = new BrowserWindow(windowOpts);

  // Load the app
  if (IS_DEV) {
    // Dev: load Vite dev server. Read .vite-port if available, else default.
    const vitePortFile = join(__dirname, "../.vite-port");
    const vitePort = existsSync(vitePortFile)
      ? parseInt(readFileSync(vitePortFile, "utf-8").trim(), 10)
      : DEFAULT_VITE_PORT;
    mainWindow.loadURL(`http://localhost:${vitePort}`);
    // Open DevTools in dev — one of the spike evaluation criteria
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load from the server's static serving (same-origin with API).
    // Using file:// would give a null origin, blocked by the CORS allowlist.
    mainWindow.loadURL(`http://localhost:${port}`);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// IPC handlers — mirror the Tauri command surface
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle("open-directory", async (_event, startingFolder?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      defaultPath: startingFolder || undefined,
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle("open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("get-server-port", () => {
    return serverPort;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  repairPath();
  registerIpcHandlers();

  try {
    const port = await spawnServer();
    console.log(`[main] Server ready on port ${port}`);
    await waitForHealth(port);
    console.log("[main] Server health check passed");
  } catch (err) {
    console.error("[main] Failed to start server:", err);
    dialog.showErrorBox(
      "Workforce — Server Error",
      `Failed to start the backend server.\n\n${err}`,
    );
    app.quit();
    return;
  }

  createWindow(serverPort);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(serverPort);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
});

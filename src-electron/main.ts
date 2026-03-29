/**
 * Electron main process — opens the app window and manages the server lifecycle.
 *
 * Architecture:
 *   - Dev: renderer loads Vite dev server. API server runs externally via `pnpm run server:watch`.
 *   - Production: server starts in-process (bundled into main process by Vite).
 *
 * Ports:
 *   - API server:  19675+ (discovered via .dev-port file or env var)
 *   - Vite dev:    19676+ (discovered via .vite-port file or env var)
 *   - CDP debug:   --remote-debugging-port (CLI flag)
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import type { ServerType } from '@hono/node-server';

// CDP debugging: use direct Electron invocation with --remote-debugging-port=9229
// before the app path. Forge's electron-forge start doesn't support Chromium flags.

const isDev = !app.isPackaged;
const appName = isDev ? 'Workforce Dev' : 'Workforce';

let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;
let serverHandle: ServerType | null = null;

// ── PATH Repair ──────────────────────────────────────────────────────────────
// macOS GUI-launched apps get a stripped PATH. Repair by sourcing the login shell.

function repairPath(): Promise<void> {
  if (isDev) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const loginShell = process.env.SHELL || '/bin/zsh';
    execFile(loginShell, ['-lc', 'printf %s "$PATH"'], { encoding: 'utf-8' }, (err, stdout) => {
      if (err) {
        // console.warn intentional — repairPath runs before server import, so tracey is
        // not available in the main process at this point.
        console.warn('repairPath failed:', err);
        resolve();
        return;
      }
      const shellPath = stdout.trim();
      if (shellPath) {
        const existing = new Set((process.env.PATH || '').split(':'));
        const extra = shellPath.split(':').filter((p) => p && !existing.has(p));
        if (extra.length) {
          process.env.PATH = `${process.env.PATH || ''}:${extra.join(':')}`;
        }
      }
      resolve();
    });
  });
}

// ── Port Discovery ───────────────────────────────────────────────────────────

import { DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT, parsePort } from '@/shared/ports';

/** Discover a port: env var > dot-file > fallback. */
function discoverPort(envVar: string, fileName: string, fallback: number): number {
  const envVal = process.env[envVar];
  if (envVal) return parsePort(envVal, fallback);
  try {
    const portStr = readFileSync(path.join(app.getAppPath(), fileName), 'utf-8').trim();
    return parsePort(portStr, fallback);
  } catch {
    return fallback;
  }
}

/** Discover Vite dev server port: env var > .vite-port file > default. */
function discoverVitePort(): number {
  return discoverPort('VITE_PORT', '.vite-port', DEFAULT_VITE_PORT);
}

/** Discover API server port: env var > .dev-port file > default. */
function discoverServerPort(): number {
  return discoverPort('SERVER_PORT', '.dev-port', DEFAULT_SERVER_PORT);
}

// ── Window ───────────────────────────────────────────────────────────────────

const iconPath = isDev
  ? path.join(app.getAppPath(), 'src-electron', 'icons', '128x128@2x.png')
  : path.join(process.resourcesPath, 'icon.icns');

function createWindow() {
  const win = new BrowserWindow({
    title: appName,
    icon: iconPath,
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 8, y: 22 },
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const vitePort = isDev ? discoverVitePort() : null;
  const activePort = isDev ? vitePort : serverPort;
  win.loadURL(`http://localhost:${activePort}`);

  // Security: prevent navigation away from the app origin
  const allowedPort = String(activePort);
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'localhost' || parsed.port !== allowedPort) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // Security: open external links in system browser, deny new windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // console.warn intentional — IPC handlers register before server import, so tracey
      // is not available in the main process at this point.
      shell.openExternal(url).catch((e) => console.warn('openExternal failed:', e));
    }
    return { action: 'deny' };
  });

  return win;
}

// ── Menu ─────────────────────────────────────────────────────────────────────

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { label: `About ${appName}`, role: 'about' },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? [
              { role: 'reload' } as const,
              { role: 'forceReload' } as const,
              { role: 'toggleDevTools' } as const,
              { type: 'separator' } as const,
            ]
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle('open-directory', async (event, startingFolder?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      defaultPath: startingFolder,
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('open-external', async (_event, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Blocked open-external for scheme: ${parsed.protocol}`);
    }
    await shell.openExternal(url);
  });

  ipcMain.handle('get-server-port', () => serverPort);
}

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  app.setName(appName);

  // CSP — only enforce in production Electron. In dev mode, Vite injects inline HMR
  // scripts that `script-src 'self'` would block. Web dev mode (pnpm run dev:web) is
  // unaffected since this code only runs inside Electron.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; connect-src 'self' http://localhost:* ws://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'",
          ],
        },
      });
    });
  }

  if (isDev) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
    app.dock?.setBadge('DEV');
  }

  buildMenu();
  registerIpcHandlers();

  // Dev: server runs externally via `pnpm run server:watch`.
  // Production: start in-process. Dynamic import so server side effects
  // (initTracey, getAgentService) only execute in production.
  // repairPath runs async so the window appears instantly; await before starting
  // the in-process server so PATH is ready for child processes.
  const pathReady = repairPath();
  if (!isDev) {
    await pathReady;
    try {
      // Vite resolves this alias at build time and code-splits into a chunk
      const { startServer } = await import('@/server/index');
      const result = await startServer();
      serverPort = result.port;
      serverHandle = result.server;
    } catch (err) {
      dialog.showErrorBox(
        'Server failed to start',
        `Could not start the backend server.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      app.quit();
      return;
    }
  } else {
    serverPort = discoverServerPort();
  }

  mainWindow = createWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Graceful shutdown: close server, wait up to 5s for connections to drain.
const SHUTDOWN_TIMEOUT_MS = 5_000;

app.on('will-quit', (event) => {
  if (!serverHandle) return;

  event.preventDefault();
  const handle = serverHandle;
  serverHandle = null;

  // Force quit after timeout if connections don't drain
  const timer = setTimeout(() => {
    app.quit();
  }, SHUTDOWN_TIMEOUT_MS);

  handle.close(() => {
    clearTimeout(timer);
    app.quit();
  });
});

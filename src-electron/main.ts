/**
 * Electron main process — starts the Hono server in-process and opens the app window.
 *
 * Architecture:
 *   - Server runs in-process on Node (no child process, no IPC).
 *   - Dynamic port discovery: scans for a free port starting at 19675.
 *   - Dev: renderer loads from Vite dev server. Server runs externally via `pnpm run server:watch`.
 *   - Production: server starts in-process, Hono serves Vite build output on the same port.
 *
 * Ports (all auto-assigned if occupied):
 *   - API server:  19675+
 *   - Vite dev:    discovered via .vite-port
 *   - CDP debug:   --remote-debugging-port (passed via CLI or auto-set in dev)
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } from 'electron';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import type { ServerType } from '@hono/node-server';

const isDev = !app.isPackaged;
const appName = isDev ? 'Workforce Dev' : 'Workforce';

let mainWindow: BrowserWindow | null = null;
let server: ServerType | null = null;
let serverPort: number | null = null;

// ── PATH Repair ──────────────────────────────────────────────────────────────
// macOS GUI-launched apps get a stripped PATH. Repair by sourcing the login shell.
// Uses -lc (login, non-interactive) to avoid MOTD/prompt output from -i.

function repairPath() {
  if (isDev) return;
  try {
    const loginShell = process.env.SHELL || '/bin/zsh';
    const shellPath = execFileSync(loginShell, ['-lc', 'printf %s "$PATH"'], {
      encoding: 'utf-8',
    }).trim();
    if (shellPath) {
      // Append login-shell entries not already present (don't shadow bundled tools)
      const existing = new Set((process.env.PATH || '').split(':'));
      const extra = shellPath.split(':').filter((p) => p && !existing.has(p));
      if (extra.length) {
        process.env.PATH = `${process.env.PATH || ''}:${extra.join(':')}`;
      }
    }
  } catch (e) {
    console.warn('repairPath failed:', e);
  }
}

// ── Dev Port Discovery ───────────────────────────────────────────────────────

// Keep in sync with src/shared/ports.ts (can't import — src-electron excluded from main tsconfig)
const DEFAULT_PORT = 19675;
const DEFAULT_VITE_PORT = 19676;

/** Parse a port string, returning the default if invalid. */
function parsePort(str: string | undefined, fallback: number): number {
  if (!str) return fallback;
  const n = parseInt(str, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Discover Vite dev server port: env var > .vite-port file > default. */
function discoverVitePort(): number {
  if (process.env.VITE_PORT) return parsePort(process.env.VITE_PORT, DEFAULT_VITE_PORT);
  try {
    const portStr = readFileSync(path.join(app.getAppPath(), '.vite-port'), 'utf-8').trim();
    return parsePort(portStr, DEFAULT_VITE_PORT);
  } catch {
    return DEFAULT_VITE_PORT;
  }
}

/** Discover API server port: env var > .dev-port file > default. Both use app root. */
function discoverServerPort(): number {
  if (process.env.SERVER_PORT) return parsePort(process.env.SERVER_PORT, DEFAULT_PORT);
  try {
    const portStr = readFileSync(path.join(app.getAppPath(), '.dev-port'), 'utf-8').trim();
    return parsePort(portStr, DEFAULT_PORT);
  } catch {
    return DEFAULT_PORT;
  }
}

// ── Window ───────────────────────────────────────────────────────────────────

// Resolve app icon — dev uses PNG from iconset, production uses bundled icns.
const iconPath = isDev
  ? path.join(app.getAppPath(), 'icon.iconset', 'icon_512x512@2x.png')
  : path.join(process.resourcesPath, 'icon.icns');

function updateWindowTitle() {
  if (!mainWindow) return;
  const parts = [appName];
  if (serverPort) parts.push(`API :${serverPort}`);
  // Show CDP port if remote debugging is enabled
  const cdpPort = app.commandLine.getSwitchValue('remote-debugging-port');
  if (cdpPort) parts.push(`CDP :${cdpPort}`);
  mainWindow.setTitle(parts.join(' — '));
}

function createWindow() {
  const win = new BrowserWindow({
    title: appName,
    icon: iconPath,
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
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
      const allowed = parsed.hostname === 'localhost' && parsed.port === allowedPort;
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  // Security: open external links in system browser, deny new windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
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
  // Native directory picker
  ipcMain.handle('open-directory', async (event, startingFolder?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      defaultPath: startingFolder,
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // Open URL in system browser — validate scheme for security
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

  // Port discovery — renderer queries this to find the API server
  ipcMain.handle('get-server-port', () => serverPort);
}

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  app.setName(appName);

  if (isDev) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
    app.dock?.setBadge('DEV');
  }

  repairPath();
  buildMenu();
  registerIpcHandlers();

  // In dev, server runs externally via `pnpm run server:watch`.
  // In production, start it in-process.
  if (!isDev) {
    try {
      const { startServer } = await import('../src/server/index');
      const result = await startServer();
      server = result.server;
      serverPort = result.port;
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
  updateWindowTitle();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      updateWindowTitle();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (server) {
    server.close();
    server = null;
  }
});

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

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import type { ServerType } from '@hono/node-server';
import { buildRendererContentSecurityPolicy } from '@/shared/content-security-policy';
import { parsePort } from '@/shared/port-utils';
import { DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT } from '@/shared/ports';
import { applyPackagedServerRuntimeEnv } from '@/shared/runtime-env';

const isDev = !app.isPackaged;
const appName = isDev ? 'Workforce Dev' : 'Workforce';

let mainWindow: BrowserWindow | null = null;
let server: ServerType | null = null;
let serverPort: number | null = null;
let isQuitting = false;
let hasRegisteredCsp = false;

// ── PATH Repair ──────────────────────────────────────────────────────────────
// macOS GUI-launched apps get a stripped PATH. Repair by sourcing the login shell.
// Uses -lc (login, non-interactive) to avoid MOTD/prompt output from -i.

function repairPath() {
  if (isDev) return;
  try {
    const loginShell = process.env.SHELL || '/bin/zsh';
    const shellPath = execFileSync(loginShell, ['-lc', 'printf %s "$PATH"'], {
      encoding: 'utf-8',
      timeout: 3_000,
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

/** Read a port from: env var > dot-file in app root > fallback. */
function discoverPort(envVar: string, dotFile: string, fallback: number): number {
  const envValue = process.env[envVar];
  if (envValue) return parsePort(envValue, fallback);
  try {
    const portStr = readFileSync(path.join(app.getAppPath(), dotFile), 'utf-8').trim();
    return parsePort(portStr, fallback);
  } catch {
    return fallback;
  }
}

function discoverVitePort(): number {
  return discoverPort('VITE_PORT', '.vite-port', DEFAULT_VITE_PORT);
}

function discoverServerPort(): number {
  return discoverPort('SERVER_PORT', '.dev-port', DEFAULT_SERVER_PORT);
}

// ── Window ───────────────────────────────────────────────────────────────────

// Resolve app icon — dev uses PNG from iconset, production uses bundled icns.
const iconPath = isDev
  ? path.join(app.getAppPath(), 'icon.iconset', 'icon_512x512@2x.png')
  : path.join(process.resourcesPath, 'icon.icns');

function applyContentSecurityPolicy(activePort: number) {
  if (hasRegisteredCsp) return;
  hasRegisteredCsp = true;

  const csp = buildRendererContentSecurityPolicy({
    isDev,
    rendererPort: activePort,
    serverPort,
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const url = new URL(details.url);
      if (url.hostname !== 'localhost') {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    } catch {
      callback({ responseHeaders: details.responseHeaders });
    }
  });
}

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
  if (!activePort) {
    throw new Error('Renderer port was not resolved before window creation');
  }
  applyContentSecurityPolicy(activePort);
  win.loadURL(`http://localhost:${activePort}`);

  // Security: prevent navigation away from the app origin
  const allowedPort = String(activePort);
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      const allowed = parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port === allowedPort;
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

async function closeServerWithTimeout(timeoutMs = 5_000): Promise<void> {
  if (!server) return;

  const closingServer = server;
  server = null;

  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      closingServer.close((error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    }),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`Server shutdown exceeded ${timeoutMs}ms, forcing app exit`);
        resolve();
      }, timeoutMs);
    }),
  ]);
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
      applyPackagedServerRuntimeEnv(app.isPackaged);
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

app.on('before-quit', (event) => {
  if (!server || isQuitting) return;

  event.preventDefault();
  isQuitting = true;

  closeServerWithTimeout()
    .catch((error) => {
      console.warn('Server shutdown failed:', error);
    })
    .finally(() => {
      app.exit(0);
    });
});

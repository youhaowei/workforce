/**
 * Electron main process — starts the Hono server in-process and opens the app window.
 *
 * Architecture:
 *   - Server runs in-process on Node (no child process, no IPC).
 *   - Dynamic port discovery: scans for a free port starting at 19675.
 *   - Dev: renderer loads from Vite dev server. Server runs externally via `bun run server:watch`.
 *   - Production: server starts in-process, Hono serves Vite build output on the same port.
 *
 * Ports (all auto-assigned if occupied):
 *   - API server:  19675+
 *   - Vite dev:    discovered via .vite-port
 *   - CDP debug:   --remote-debugging-port (passed via CLI or auto-set in dev)
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import path from 'path';
import type { ServerType } from '@hono/node-server';
import { createLogger } from 'tracey';
import { buildRendererContentSecurityPolicy } from '@/shared/content-security-policy';
import { DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT } from '@/shared/ports';
import { applyPackagedServerRuntimeEnv } from '@/shared/runtime-env';
import {
  repairPath as repairPathImpl,
  discoverPort,
  closeServerWithTimeout as closeServerImpl,
  waitForHealth,
  validateExternalUrl,
  isAllowedNavigation,
} from './helpers';

const isDev = !app.isPackaged;
const appName = isDev ? 'Workforce Dev' : 'Workforce';
const log = createLogger('electron-main');

let mainWindow: BrowserWindow | null = null;
let server: ServerType | null = null;
let serverPort: number | null = null;
let rendererPort: number | null = null;
let isQuitting = false;

// ── PATH Repair ──────────────────────────────────────────────────────────────

function repairPath() {
  if (isDev) return;
  const loginShell = process.env.SHELL || '/bin/zsh';
  const result = repairPathImpl(process.env.PATH, loginShell);
  if (result === undefined) {
    log.warn('repairPath failed');
  } else {
    process.env.PATH = result;
  }
}

// ── Dev Port Discovery ───────────────────────────────────────────────────────

function discoverVitePort(): number {
  return discoverPort('VITE_PORT', '.vite-port', DEFAULT_VITE_PORT, app.getAppPath());
}

function discoverServerPort(): number {
  return discoverPort('SERVER_PORT', '.dev-port', DEFAULT_SERVER_PORT, app.getAppPath());
}

// ── Window ───────────────────────────────────────────────────────────────────

// Resolve app icon — dev uses PNG from iconset, production uses bundled icns.
const iconPath = isDev
  ? path.join(app.getAppPath(), 'icon.iconset', 'icon_512x512@2x.png')
  : path.join(process.resourcesPath, 'icon.icns');

function applyContentSecurityPolicy(activePort: number) {
  const csp = buildRendererContentSecurityPolicy({
    isDev,
    rendererPort: activePort,
    serverPort,
  });

  const localhostPrefix = 'http://localhost';
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(localhostPrefix)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
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

  const activePort = isDev ? discoverVitePort() : serverPort;
  if (!activePort) {
    throw new Error('Renderer port was not resolved before window creation');
  }
  rendererPort = activePort;
  applyContentSecurityPolicy(activePort);
  win.loadURL(`http://localhost:${activePort}`);

  // Signal fullscreen state so drag regions are disabled in fullscreen
  const syncFullscreen = () => {
    const js = win.isFullScreen()
      ? 'document.documentElement.dataset.fullscreen = ""'
      : 'delete document.documentElement.dataset.fullscreen';
    win.webContents.executeJavaScript(js).catch(() => {});
  };
  win.on('enter-full-screen', syncFullscreen);
  win.on('leave-full-screen', syncFullscreen);
  win.on('closed', () => { mainWindow = null; });

  return win;
}

async function closeServer(timeoutMs = 5_000): Promise<void> {
  if (!server) return;
  const closingServer = server;
  server = null;
  await closeServerImpl(closingServer, timeoutMs, (ctx, msg) => log.warn(ctx, msg));
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
              {
                label: 'Toggle Developer Tools',
                accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                click: () => {
                  if (!mainWindow) return;
                  if (mainWindow.webContents.isDevToolsOpened()) {
                    mainWindow.webContents.closeDevTools();
                  } else {
                    mainWindow.webContents.openDevTools({ mode: 'detach' });
                  }
                },
              },
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
    const parsed = validateExternalUrl(url);
    await shell.openExternal(parsed.href);
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

  // Deny all permission requests (camera, mic, geolocation, etc.) by default.
  // The app loads http://localhost content — any XSS could silently request these.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // Security: register navigation guards on ALL webContents (not per-window)
  // so any dynamically created webContents also get protection.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (navEvent) => {
      if (!rendererPort || !isAllowedNavigation(navEvent.url, rendererPort)) {
        navEvent.preventDefault();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = validateExternalUrl(url);
        shell.openExternal(parsed.href).catch((error) => log.warn({ error, url }, 'openExternal failed'));
      } catch { /* blocked or invalid URL */ }
      return { action: 'deny' };
    });
  });

  // In dev, server runs externally via `bun run server:watch`.
  // In production, start it in-process.
  if (!isDev) {
    try {
      applyPackagedServerRuntimeEnv(app.isPackaged);
      const { startServer } = await import('../src/server/index');
      // Pass explicit staticDir so production doesn't rely on __dirname heuristics
      const staticDir = path.join(app.getAppPath(), 'dist');
      const result = await startServer({ staticDir });
      server = result.server;
      serverPort = result.port;

      // Wait for the server to be fully ready (middleware + routes), not just bound
      const ready = await waitForHealth(`http://localhost:${result.port}/health`, 10_000);
      if (!ready) log.warn('Health check timed out — proceeding anyway');
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      updateWindowTitle();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!server || isQuitting) return;

  event.preventDefault();
  isQuitting = true;

  closeServer()
    .catch((error) => {
      log.warn({ error }, 'Server shutdown failed');
    })
    .finally(() => {
      app.exit(0);
    });
});

/**
 * Electron main process — runs the Hono HTTP server in-process and opens a BrowserWindow.
 *
 * In dev mode, Vite writes .vite-port; Electron reads it to load the correct URL.
 * In production, Hono serves the Vite build output on the server port (same origin as API).
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } from 'electron';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import type { ServerType } from '@hono/node-server';
import { startServer } from '../server/index';
import { DEFAULT_SERVER_PORT } from '../shared/ports';

const isDev = !app.isPackaged;
const appName = isDev ? 'Workforce Dev' : 'Workforce';
let serverPort = DEFAULT_SERVER_PORT;
let server: ServerType | null = null;

/** Read .vite-port written by Vite dev server on startup. */
function discoverVitePort(): string {
  try {
    return readFileSync(path.join(app.getAppPath(), '.vite-port'), 'utf-8').trim();
  } catch {
    return '19676'; // fallback
  }
}

// Resolve the app icon.
// In dev: use high-res PNG from iconset. In production: bundled icns in Resources/.
// dock.setIcon() requires PNG on macOS — icns is ignored.
const iconPath = isDev
  ? path.join(app.getAppPath(), 'icon.iconset', 'icon_512x512@2x.png')
  : path.join(process.resourcesPath, 'icon.icns');

// Repair PATH for GUI-launched apps (macOS strips shell-customized PATH).
// Without this, the Agent SDK can't find `claude` CLI in production.
function repairPath() {
  if (isDev) return;
  try {
    const loginShell = process.env.SHELL || '/bin/zsh';
    const shellPath = execFileSync(loginShell, ['-l', '-c', 'printf %s "$PATH"'], {
      encoding: 'utf-8',
    }).trim();
    if (shellPath) {
      const currentPath = process.env.PATH || '';
      process.env.PATH = `${shellPath}:${currentPath}`;
    }
  } catch {
    /* fall through to default PATH */
  }
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
  const loadUrl = isDev ? `http://localhost:${vitePort}` : `http://localhost:${serverPort}`;
  win.loadURL(loadUrl);

  // Security: prevent navigation away from the app
  const allowedPort = isDev ? vitePort : String(serverPort);
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      const allowed = parsed.hostname === 'localhost' && parsed.port === allowedPort;
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  // Security: open external links in the system browser, deny new windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

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

// IPC: native directory picker
ipcMain.handle('open-directory', async (event, startingFolder?: string) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return null;

  const result = await dialog.showOpenDialog(senderWindow, {
    defaultPath: startingFolder,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

app.whenReady().then(async () => {
  app.setName(appName);
  if (isDev) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
    app.dock?.setBadge('DEV');
  }
  repairPath();
  buildMenu();

  // In dev, the server is started externally via `pnpm run server:watch`.
  // In production, start it in-process.
  if (!isDev) {
    try {
      const result = await startServer({ port: serverPort });
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
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});

// Ensure cleanup on Cmd+Q (may bypass window-all-closed in some scenarios)
app.on('will-quit', () => {
  if (server) server.close();
});

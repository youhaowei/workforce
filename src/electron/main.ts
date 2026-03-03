/**
 * Electron main process — spawns the Bun HTTP server and opens a BrowserWindow.
 *
 * In dev mode, Vite writes .vite-port; Electron reads it to load the correct URL.
 * In production, Hono serves the Vite build output on :4096 (same origin as API).
 */

import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { createWriteStream, readFileSync, type WriteStream } from 'fs';
import path from 'path';
import { SERVER_PORT, HEALTH_PATH } from '../shared/constants';

const isDev = !app.isPackaged;

/** Read .vite-port written by Vite dev server on startup. */
function discoverVitePort(): string {
  try {
    return readFileSync(path.join(app.getAppPath(), '.vite-port'), 'utf-8').trim();
  } catch {
    return '5173'; // fallback
  }
}
let bunProcess: ChildProcess | null = null;
let logStream: WriteStream | null = null;

// Resolve the app icon — dock.setIcon needs PNG, not icns.
const iconPath = isDev
  ? path.join(app.getAppPath(), 'icon.iconset', 'icon_512x512.png')
  : path.join(process.resourcesPath, 'icon.icns');

// Repair PATH for GUI-launched apps (macOS strips shell-customized PATH).
// Without this, the Agent SDK can't find `claude` CLI in production.
function repairPath() {
  if (isDev) return;
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const shellPath = execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
      encoding: 'utf-8',
    }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    /* fall through to default PATH */
  }
}

/** Returns the Bun version string, or null if bun is not on PATH. */
function checkBunAvailable() {
  try {
    return execFileSync('bun', ['--version'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function spawnBunServer() {
  // In production, server code is unpacked outside the asar archive.
  // process.resourcesPath → Resources/, unpacked server at app.asar.unpacked/src/server/
  const serverEntry = isDev
    ? path.join(app.getAppPath(), 'src', 'server', 'index.ts')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'server', 'index.ts');

  // In production, redirect server output to a log file in the user data dir.
  // In dev, inherit stdio so logs appear in the terminal.
  let stdio: 'inherit' | ['ignore', WriteStream, WriteStream] = 'inherit';
  if (!isDev) {
    const logPath = path.join(app.getPath('userData'), 'server.log');
    logStream = createWriteStream(logPath, { flags: 'a' });
    stdio = ['ignore', logStream, logStream];
  }

  bunProcess = spawn('bun', ['run', serverEntry], {
    env: { ...process.env, PORT: SERVER_PORT },
    stdio,
  });

  bunProcess.on('error', (err) => {
    console.error('[electron] Failed to start Bun server:', err);
  });
}

async function waitForServer(url: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Bail early if the server process already exited
    if (bunProcess && bunProcess.exitCode !== null) {
      throw new Error(`Bun server exited with code ${bunProcess.exitCode} before becoming ready`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* server not ready yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Workforce',
    icon: iconPath,
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const vitePort = isDev ? discoverVitePort() : null;
  const loadUrl = isDev ? `http://localhost:${vitePort}` : `http://localhost:${SERVER_PORT}`;
  win.loadURL(loadUrl);

  return win;
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Workforce',
      submenu: [
        { label: 'About Workforce', role: 'about' },
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
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
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

/** Graceful shutdown: SIGTERM → 3 s grace → SIGKILL. */
function killBunProcess() {
  if (!bunProcess) return;
  const proc = bunProcess;
  bunProcess = null;

  proc.kill('SIGTERM');
  const forceKill = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
  }, 3_000);

  proc.on('exit', () => clearTimeout(forceKill));

  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

// IPC: native directory picker
ipcMain.handle('open-directory', async (_event, startingFolder?: string) => {
  const result = await dialog.showOpenDialog({
    defaultPath: startingFolder,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

app.whenReady().then(async () => {
  app.setName('Workforce');
  if (isDev) app.dock?.setIcon(iconPath);
  repairPath();
  buildMenu();

  // In dev, the server is started externally via `bun run server:watch`.
  // In production, we spawn it ourselves.
  if (!isDev) {
    const bunVersion = checkBunAvailable();
    if (!bunVersion) {
      dialog.showErrorBox(
        'Bun not found',
        'Workforce requires Bun to run.\n\nInstall it from https://bun.sh and restart the app.',
      );
      app.quit();
      return;
    }

    try {
      spawnBunServer();
      await waitForServer(`http://localhost:${SERVER_PORT}${HEALTH_PATH}`);
    } catch (err) {
      dialog.showErrorBox(
        'Server failed to start',
        `The Bun server did not become ready.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      killBunProcess();
      app.quit();
      return;
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killBunProcess();
  app.quit();
});

// Ensure cleanup on Cmd+Q (may bypass window-all-closed in some scenarios)
app.on('will-quit', () => {
  killBunProcess();
});

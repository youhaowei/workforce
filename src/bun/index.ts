/**
 * Electrobun main process — starts the HTTP server and opens a BrowserWindow.
 *
 * In dev mode, the Vite HMR server runs on :5173 so the window loads from there.
 * In production, Hono serves the Vite build output on :4096 (same origin as API).
 */

import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';
import { execFileSync } from 'child_process';

// Detect dev mode via NODE_ENV (set by the `dev` script in package.json)
const isDev = process.env.NODE_ENV === 'development';

// Repair PATH for GUI-launched apps (macOS strips shell-customized PATH).
// Without this, the Agent SDK can't find `claude` CLI in production.
if (!isDev) {
  try {
    const shellPath = execFileSync('zsh', ['-l', '-c', 'echo $PATH'], { encoding: 'utf-8' }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch { /* fall through to default PATH */ }

  // Dynamic import via string variable prevents Electrobun's bundler from
  // trying to resolve the entire server dependency tree at build time.
  // The server module is loaded at runtime from the unbundled source.
  const serverModule = '../server/index';
  const { startServer } = await import(serverModule);
  startServer();
}

// Native application menu
ApplicationMenu.setApplicationMenu([
  {
    label: 'Workforce',
    submenu: [
      { label: 'About Workforce' },
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
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'close' },
    ],
  },
]);

const _win = new BrowserWindow({
  title: 'Workforce',
  url: isDev ? 'http://localhost:5173' : 'http://localhost:4096',
  frame: { x: 0, y: 0, width: 1200, height: 800 },
});

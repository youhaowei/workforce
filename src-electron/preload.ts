/**
 * Electron preload script — exposes a minimal bridge to the renderer.
 *
 * The renderer detects Electron via `window.electronAPI` and uses it
 * for native capabilities (file dialogs, URL opening, server port).
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openDirectory: (startingFolder?: string) =>
    ipcRenderer.invoke("open-directory", startingFolder),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  getServerPort: () => ipcRenderer.invoke("get-server-port"),
});

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openDirectory: (startingFolder?: string) => ipcRenderer.invoke("open-directory", startingFolder),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  getServerPort: () => ipcRenderer.invoke("get-server-port"),
});

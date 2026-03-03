import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: (startingFolder?: string) =>
    ipcRenderer.invoke('open-directory', startingFolder),
});

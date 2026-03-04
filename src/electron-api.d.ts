/** Type declarations for the Electron preload API exposed via contextBridge. */
interface ElectronAPI {
  openDirectory(startingFolder?: string): Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

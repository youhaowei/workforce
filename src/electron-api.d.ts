/** Extend Window with the Electron preload bridge. */

interface ElectronAPI {
  openDirectory: (startingFolder?: string) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  getServerPort: () => Promise<number>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

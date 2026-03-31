/** Type augmentation for the Electron preload bridge. */

export interface ElectronAPI {
  openDirectory: (startingFolder?: string) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  getServerPort: () => Promise<number | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/** Type declarations for the Electron preload bridge (window.electronAPI). */
interface ElectronAPI {
  openDirectory: (startingFolder?: string) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  getServerPort: () => Promise<number | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}

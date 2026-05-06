import { create } from "zustand";

export type SidebarMode = "expanded" | "collapsed";
export type ShellError = string | { message: string; code?: string };

interface ShellStore {
  // Panel states
  themePanelOpen: boolean;
  infoPanelCollapsed: boolean;
  sidebarMode: SidebarMode;

  // Board filters
  boardKeyword: string;
  boardStatusFilter: string;

  // Project creation dialog
  createProjectDialogOpen: boolean;
  createProjectDialogSource: "projects-panel" | "new-session" | null;
  newSessionProjectId: string | null;

  // Server connection
  serverConnected: boolean;
  error: ShellError | null;

  // Actions
  setThemePanelOpen: (open: boolean) => void;
  setInfoPanelCollapsed: (collapsed: boolean) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setBoardKeyword: (keyword: string) => void;
  setBoardStatusFilter: (filter: string) => void;
  setCreateProjectDialog: (open: boolean, source: "projects-panel" | "new-session" | null) => void;
  setNewSessionProjectId: (id: string | null) => void;
  setServerConnected: (connected: boolean) => void;
  setError: (error: ShellError | null) => void;
}

// Storage keys for persistence
const SIDEBAR_STORAGE_KEY = "workforce:sidebar-mode";
const INFO_PANEL_STORAGE_KEY = "workforce:info-panel-collapsed";

export const useShellStore = create<ShellStore>((set) => ({
  // Initial state from localStorage or defaults
  themePanelOpen: false,
  infoPanelCollapsed: localStorage.getItem(INFO_PANEL_STORAGE_KEY) !== "false", // Default true
  sidebarMode: (localStorage.getItem(SIDEBAR_STORAGE_KEY) as SidebarMode) || "expanded",
  boardKeyword: "",
  boardStatusFilter: "all",
  createProjectDialogOpen: false,
  createProjectDialogSource: null,
  newSessionProjectId: null,
  serverConnected: true,
  error: null,

  // Actions
  setThemePanelOpen: (open) => set({ themePanelOpen: open }),

  setInfoPanelCollapsed: (collapsed) => {
    localStorage.setItem(INFO_PANEL_STORAGE_KEY, String(collapsed));
    set({ infoPanelCollapsed: collapsed });
  },

  setSidebarMode: (mode) => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
    set({ sidebarMode: mode });
  },

  setBoardKeyword: (keyword) => set({ boardKeyword: keyword }),
  setBoardStatusFilter: (filter) => set({ boardStatusFilter: filter }),

  setCreateProjectDialog: (open, source) =>
    set({ createProjectDialogOpen: open, createProjectDialogSource: source }),

  setNewSessionProjectId: (id) => set({ newSessionProjectId: id }),
  setServerConnected: (connected) => set({ serverConnected: connected }),
  setError: (error) => set({ error: error }),
}));

import { create } from 'zustand';

export type MainTab = 'chat' | 'templates' | 'workflows' | 'board' | 'reviews' | 'history';

interface AppState {
  tab: MainTab;
  sessionsOpen: boolean;
  todosOpen: boolean;
  currentSessionId: string | null;
  selectedWorkAgentId: string | null;
  setTab: (tab: MainTab) => void;
  toggleSessions: () => void;
  toggleTodos: () => void;
  setCurrentSessionId: (id: string | null) => void;
  setSelectedWorkAgentId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'chat',
  sessionsOpen: false,
  todosOpen: false,
  currentSessionId: null,
  selectedWorkAgentId: null,
  setTab(tab) {
    set({ tab });
  },
  toggleSessions() {
    set((state) => ({ sessionsOpen: !state.sessionsOpen }));
  },
  toggleTodos() {
    set((state) => ({ todosOpen: !state.todosOpen }));
  },
  setCurrentSessionId(id) {
    set({ currentSessionId: id });
  },
  setSelectedWorkAgentId(id) {
    set({ selectedWorkAgentId: id });
  },
}));

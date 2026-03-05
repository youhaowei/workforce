import { WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Surface } from '@/components/ui/surface';
import { StageFloatingPill } from './StageFloatingPill';

interface MainContentColumnProps {
  serverConnected: boolean;
  showFloatingPill?: boolean;
  sessionTitle?: string;
  sessionsPanelOpen?: boolean;
  infoPanelOpen?: boolean;
  onToggleSessions?: () => void;
  onToggleInfo?: () => void;
  children: ReactNode;
}

export function MainContentColumn({
  serverConnected,
  showFloatingPill,
  sessionTitle,
  sessionsPanelOpen = false,
  infoPanelOpen = false,
  onToggleSessions,
  onToggleInfo,
  children,
}: MainContentColumnProps) {
  return (
    <Surface variant="stage" className="flex-1 flex flex-col min-w-0 rounded-[10px] shadow-[var(--surface-shadow)] relative z-2">
      {!serverConnected && (
        <div className="px-4 py-3 bg-neutral-bg-dim/50 border-b flex items-center gap-3">
          <WifiOff className="h-4 w-4 text-neutral-fg-subtle" />
          <div>
            <p className="text-sm font-medium">Server not connected</p>
            <p className="text-xs text-neutral-fg-subtle">
              Run <code className="bg-neutral-bg-dim px-1.5 py-0.5 rounded text-xs font-mono">pnpm run server</code> to start
            </p>
          </div>
        </div>
      )}

      {showFloatingPill && onToggleSessions && onToggleInfo && (
        <StageFloatingPill
          sessionTitle={sessionTitle}
          sessionsPanelOpen={sessionsPanelOpen}
          infoPanelOpen={infoPanelOpen}
          onToggleSessions={onToggleSessions}
          onToggleInfo={onToggleInfo}
        />
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </Surface>
  );
}

import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Stage } from "@/components/ui/stage";
import { StageFloatingPill } from "./StageFloatingPill";

interface MainContentColumnProps {
  serverConnected: boolean;
  showFloatingPill?: boolean;
  infoPanelOpen?: boolean;
  projectRootPath?: string | null;
  onToggleInfo?: () => void;
  onGitClick?: () => void;
  children: ReactNode;
}

export function MainContentColumn({
  serverConnected,
  showFloatingPill,
  infoPanelOpen = false,
  projectRootPath,
  onToggleInfo,
  onGitClick,
  children,
}: MainContentColumnProps) {
  return (
    <Stage>
      {!serverConnected && (
        <div className="px-4 py-3 bg-neutral-bg-dim/50 border-b flex items-center gap-3">
          <WifiOff className="h-4 w-4 text-neutral-fg-subtle" />
          <div>
            <p className="text-sm font-medium">Server not connected</p>
            <p className="text-xs text-neutral-fg-subtle">
              Run{" "}
              <code className="bg-neutral-bg-dim px-1.5 py-0.5 rounded text-xs font-mono">
                bun run server
              </code>{" "}
              to start
            </p>
          </div>
        </div>
      )}

      {showFloatingPill && onToggleInfo && (
        <StageFloatingPill
          infoPanelOpen={infoPanelOpen}
          projectRootPath={projectRootPath}
          onToggleInfo={onToggleInfo}
          onGitClick={onGitClick}
        />
      )}

      {children}
    </Stage>
  );
}

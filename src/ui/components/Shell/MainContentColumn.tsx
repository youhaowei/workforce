import { AlertCircle, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface MainContentColumnProps {
  serverConnected: boolean;
  error: string | null;
  onDismissError: () => void;
  children: ReactNode;
}

export function MainContentColumn({
  serverConnected,
  error,
  onDismissError,
  children,
}: MainContentColumnProps) {
  return (
    <div className="center-stage">
      {!serverConnected && (
        <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-3">
          <WifiOff className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Server not connected</p>
            <p className="text-xs text-muted-foreground">
              Run <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">bun run server</code> to start
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 my-2 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismissError} className="text-destructive h-7">
            Dismiss
          </Button>
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}

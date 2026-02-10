/**
 * ToolProgress - Running tool indicator with live elapsed time.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ToolProgressProps {
  toolName: string;
  startTime: number;
  onCancel?: () => void;
}

export default function ToolProgress({ toolName, startTime, onCancel }: ToolProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  const formatElapsed = () => {
    if (elapsed < 1000) return `${elapsed}ms`;
    return `${(elapsed / 1000).toFixed(1)}s`;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-md">
      <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm font-medium truncate">{toolName}</div>
        <div className="text-xs text-muted-foreground">{formatElapsed()}</div>
      </div>
      {onCancel && (
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

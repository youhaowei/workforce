/**
 * ToolOutput - Expandable tool execution status and output display.
 */

import { useState, useMemo, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolUIStatus } from '@/ui/stores/useToolStore';
import { formatToolResult } from '@/ui/formatters';

interface ToolOutputProps {
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: string;
  status: ToolUIStatus | 'success' | 'running';
  duration?: number;
  startTime?: number;
}

function statusVariant(status: ToolOutputProps['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running': return 'default';
    case 'success': return 'secondary';
    case 'failed':
    case 'cancelled': return 'destructive';
    default: return 'outline';
  }
}

export default function ToolOutput({ toolName, args, result, error, status, duration, startTime }: ToolOutputProps) {
  const [isExpanded, setIsExpanded] = useState(status === 'failed');
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (status === 'running' && startTime) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [status, startTime]);

  const formattedResult = useMemo(() => {
    if (error) return { summary: '', detail: '', isError: true };
    if (result === undefined) return { summary: '', detail: '', isError: false };
    return formatToolResult(toolName, result);
  }, [error, result, toolName]);

  const formattedArgs = useMemo(() => {
    try {
      if (!args || Object.keys(args as object).length === 0) return '';
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }, [args]);

  const displayDuration = useMemo(() => {
    if (duration !== undefined) return `${duration}ms`;
    if (status === 'running' && elapsedTime > 0) return `${Math.round(elapsedTime / 100) / 10}s`;
    return null;
  }, [duration, status, elapsedTime]);

  const hasContent = Boolean(formattedArgs || formattedResult.detail || error);

  const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }, [toggle]);

  return (
    <div className="border rounded-md overflow-hidden text-sm bg-card">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`Toggle ${toolName} details`}
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-accent/50"
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />}
          <span className="font-mono font-medium truncate" title={toolName}>{toolName}</span>
          <Badge variant={statusVariant(status)} className="text-[10px]">{status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {displayDuration && <span className="text-xs text-muted-foreground">{displayDuration}</span>}
          {hasContent && (isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />)}
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && hasContent && (
        <div className="px-3 py-2 border-t bg-background">
          {formattedResult.summary && !error && (
            <div className="text-xs text-muted-foreground mb-2">{formattedResult.summary}</div>
          )}

          {formattedArgs && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Arguments</summary>
              <pre className="font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap mt-1">{formattedArgs}</pre>
            </details>
          )}

          {error && <div className="text-xs text-destructive font-medium">{error}</div>}

          {!error && formattedResult.detail && (
            <pre className="font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{formattedResult.detail}</pre>
          )}
        </div>
      )}
    </div>
  );
}

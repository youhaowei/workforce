/**
 * InlineToolCard — Compact inline card for a single tool invocation.
 *
 * Shows tool name, one-line input summary, status indicator,
 * and expandable result/error (collapsed by default).
 */

import { useState, useMemo, useCallback, type KeyboardEvent } from 'react';
import { Loader2, Check, X, ChevronRight } from 'lucide-react';
import type { ContentBlock } from '@/services/types';

type ToolBlock = ContentBlock & { type: 'tool_use' };

interface InlineToolCardProps {
  block: ToolBlock;
}

const MAX_RESULT_LENGTH = 500;

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function formatResult(result: unknown) {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}

function StatusIcon({ status }: { status: ToolBlock['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />;
    case 'complete':
      return <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />;
    case 'error':
      return <X className="h-3 w-3 text-destructive flex-shrink-0" />;
  }
}

export default function InlineToolCard({ block }: InlineToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  }, [toggle]);

  const resultText = useMemo(() => {
    if (block.error) return block.error;
    return formatResult(block.result);
  }, [block.error, block.result]);

  const hasExpandableContent = resultText.length > 0 || block.input.length > 0;

  return (
    <div className="my-1.5 border rounded-lg overflow-hidden text-xs bg-background/50">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle ${block.name} details`}
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-accent/30"
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <StatusIcon status={block.status} />
        <span className="font-mono font-medium text-foreground/80">{block.name}</span>
        {block.input && (
          <span className="text-muted-foreground truncate flex-1">{truncate(block.input, 80)}</span>
        )}
        {hasExpandableContent && (
          <ChevronRight
            className={`h-3 w-3 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </div>
      {expanded && hasExpandableContent && (
        <div className="px-3 py-2 border-t bg-muted/20 space-y-1.5">
          {block.input && (
            <div>
              <span className="text-muted-foreground font-medium">Input: </span>
              <span className="text-muted-foreground">{block.input}</span>
            </div>
          )}
          {block.error && (
            <div className="text-destructive">{block.error}</div>
          )}
          {!block.error && resultText && (
            <pre className="font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
              {truncate(resultText, MAX_RESULT_LENGTH)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

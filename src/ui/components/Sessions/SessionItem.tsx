/**
 * SessionItem - Individual session row in the sidebar list.
 *
 * Layout: [state-dot + type-icon] Title   time [delete]
 *
 * State is conveyed by a small colored dot (green=active, amber=paused,
 * red=failed, etc.) instead of text badges for faster visual scanning.
 */

import { useMemo, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Bot, MessageSquare } from 'lucide-react';
import type { LifecycleState, SessionLifecycle, SessionSummary, SessionType } from '@/services/types';
import { stripMarkdown } from '@/ui/formatters';

const STATE_DOT_COLOR: Record<LifecycleState, string> = {
  created: 'bg-neutral-300',
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  completed: 'bg-blue-500',
  failed: 'bg-red-500',
  cancelled: 'bg-neutral-400',
};

export interface SessionItemProps {
  session: SessionSummary;
  isActive?: boolean;
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: SessionItemProps) {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - session.updatedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }, [session.updatedAt]);

  const sessionType = (session.metadata?.type as SessionType) ?? 'chat';
  const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
  const lifecycleState = lifecycle?.state;
  const dotColor = lifecycleState ? STATE_DOT_COLOR[lifecycleState] : undefined;

  const rawTitle = session.title
    || (sessionType === 'workagent' ? (session.metadata?.goal as string) ?? 'Agent' : 'Untitled');
  const title = stripMarkdown(rawTitle);

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(session.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group px-3 py-2 cursor-pointer border-b transition-colors overflow-hidden ${
        isActive
          ? 'bg-accent border-l-2 border-l-primary'
          : 'hover:bg-muted/50'
      }`}
      onClick={() => onSelect?.(session.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(session.id);
        }
      }}
    >
      <div className="flex items-start gap-1.5">
        {/* Type icon with state dot overlay */}
        <div className="relative shrink-0 mt-0.5">
          {sessionType === 'workagent' ? (
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {dotColor && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-background ${dotColor}`}
              title={lifecycleState}
            />
          )}
        </div>
        <span className={`text-sm font-medium flex-1 min-w-0 break-words line-clamp-2 ${isActive ? 'text-primary' : ''}`}>
          {title}
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
          {timeAgo}
        </span>
        <div className={`shrink-0 transition-opacity ${
          isActive
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-destructive hover:text-destructive"
            onClick={handleDelete}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Delete session"
            title="Delete session"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * SessionItem - Individual session display
 *
 * Shows session title, preview, timestamp, lifecycle state, and session type
 * with hover actions for fork/delete.
 */

import { useMemo, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GitFork, Trash2, Bot, MessageSquare } from 'lucide-react';
import { stateVariant } from '@/ui/lib/stateVariant';
import type { SessionLifecycle, SessionSummary, SessionType } from '@/services/types';

export interface SessionItemProps {
  session: SessionSummary;
  isActive?: boolean;
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onFork?: (sessionId: string) => void;
}

export function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onFork,
}: SessionItemProps) {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - session.updatedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [session.updatedAt]);

  const messageCount = session.messageCount;

  const preview = useMemo(() => {
    const content = session.lastMessagePreview;
    if (!content) return 'No messages';
    return content.length > 100 ? content.slice(0, 100) + '...' : content;
  }, [session.lastMessagePreview]);

  const sessionType = (session.metadata?.type as SessionType) ?? 'chat';
  const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
  const lifecycleState = lifecycle?.state;

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(session.id);
  };

  const handleFork = (e: MouseEvent) => {
    e.stopPropagation();
    onFork?.(session.id);
  };

  return (
    <div
      className={`group p-3 cursor-pointer border-b hover:bg-muted/50 transition-colors ${
        isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
      }`}
      onClick={() => onSelect?.(session.id)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {sessionType === 'workagent' ? (
            <Bot className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <h3 className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>
            {session.title || (sessionType === 'workagent' ? (session.metadata?.goal as string) ?? 'Agent' : 'Untitled Session')}
          </h3>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
          {timeAgo}
        </span>
      </div>

      {/* Preview */}
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{preview}</p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{messageCount} messages</span>
          {session.parentId && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">forked</Badge>
          )}
          {lifecycleState && lifecycleState !== 'created' && (
            <Badge variant={stateVariant(lifecycleState)} className="text-[10px] h-4 px-1">
              {lifecycleState}
            </Badge>
          )}
        </div>

        {/* Actions - visible on hover */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleFork} title="Fork session">
            <GitFork className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={handleDelete} title="Delete session">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

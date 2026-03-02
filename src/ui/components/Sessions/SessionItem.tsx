/**
 * SessionItem - Individual session row in the sidebar list.
 *
 * Layout inspired by craft-agents-oss:
 *   [status-circle]  Title (up to 2 lines)
 *                    [badge] [badge]           time-ago
 *
 * Status is a colored circle icon. Badges show session type and project.
 */

import { useMemo, type MouseEvent } from 'react';
import { Trash2, Circle, CheckCircle2, PlayCircle, PauseCircle, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDialogStore } from '@/ui/stores/useDialogStore';
import type { LifecycleState, SessionLifecycle, SessionSummary, SessionType } from '@/services/types';
import { stripMarkdown } from '@/ui/formatters';

const STATE_ICON: Record<LifecycleState, { icon: typeof Circle; className: string }> = {
  created: { icon: Circle, className: 'text-muted-foreground/40' },
  active: { icon: PlayCircle, className: 'text-emerald-500' },
  paused: { icon: PauseCircle, className: 'text-amber-500' },
  completed: { icon: CheckCircle2, className: 'text-blue-500' },
  failed: { icon: AlertCircle, className: 'text-red-500' },
  cancelled: { icon: XCircle, className: 'text-muted-foreground/50' },
};

const TYPE_BADGE_STYLE: Record<string, string> = {
  chat: 'bg-muted text-muted-foreground',
  workagent: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
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
  const lifecycleState = lifecycle?.state ?? 'created';
  const stateConfig = STATE_ICON[lifecycleState];
  const StateIcon = stateConfig.icon;

  const projectName = session.metadata?.projectName as string | undefined;

  const rawTitle = session.title
    || (sessionType === 'workagent' ? (session.metadata?.goal as string) ?? 'Agent' : 'Untitled');
  const title = stripMarkdown(rawTitle);

  const typeLabel = sessionType === 'workagent' ? 'Execute' : undefined;

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    const confirmed = await useDialogStore.getState().confirm({
      title: 'Delete session?',
      description: `"${title}" will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (confirmed) onDelete?.(session.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`session-item group px-3 py-2.5 cursor-pointer transition-colors ${
        isActive
          ? 'bg-accent'
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
      {/* Row 1: status icon + title */}
      <div className="flex items-start gap-2.5">
        <StateIcon className={`h-4 w-4 mt-0.5 shrink-0 ${stateConfig.className}`} />
        <span className={`text-sm leading-snug line-clamp-2 flex-1 min-w-0 ${
          isActive ? 'font-medium' : ''
        }`}>
          {title}
        </span>
      </div>

      {/* Row 2: badges + time-ago */}
      <div className="flex items-center gap-1.5 mt-1.5 pl-[26px]">
        {typeLabel && (
          <span className={`inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium ${TYPE_BADGE_STYLE[sessionType]}`}>
            {typeLabel}
          </span>
        )}
        {projectName && (
          <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
            {projectName}
          </span>
        )}
        {session.parentId && (
          <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
            fork
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground/60 tabular-nums shrink-0">
          {timeAgo}
        </span>

        {/* Delete — hover reveal */}
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 -mr-1 shrink-0 text-muted-foreground hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleDelete}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Delete session"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

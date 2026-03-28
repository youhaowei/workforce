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
import { Trash2, Folder } from 'lucide-react';
import { timeAgo } from '@/ui/lib/time';
import { CLAUDE_COLOR } from '@/ui/lib/brand-colors';
import { ClaudeIcon } from '@/ui/components/icons/ClaudeIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDialogStore } from '@/ui/stores/useDialogStore';
import type { LifecycleState, SessionLifecycle, SessionSummary, SessionType } from '@/services/types';
import { stripMarkdown } from '@/ui/formatters';
import { smartTruncateTitle } from './sessionListHelpers';

const STATE_DOT_COLOR: Record<LifecycleState, string> = {
  created: 'bg-neutral-fg-subtle/30',
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  completed: 'bg-blue-500',
  failed: 'bg-red-500',
  cancelled: 'bg-neutral-fg-subtle/40',
};

const TYPE_BADGE_COLOR: Record<string, 'default' | 'warning'> = {
  chat: 'default',
  workagent: 'warning',
};

function deriveTitle(session: SessionSummary): string {
  const sessionType = (session.metadata?.type as SessionType) ?? 'chat';
  const isCC = session.metadata?.source === 'claude-code';
  const raw = session.title
    || (sessionType === 'workagent' ? (session.metadata?.goal as string) ?? 'Agent' : null)
    || (isCC ? 'Claude Session' : 'Untitled');
  return smartTruncateTitle(stripMarkdown(raw));
}

export interface SessionItemProps {
  session: SessionSummary;
  isActive?: boolean;
  projectName?: string;
  /** Hex color for the project dot (from Project.color) */
  projectColor?: string;
  /** True when projectName is derived from session cwd rather than a matched project */
  isCwdFolder?: boolean;
  /** Which timestamp to show as time-ago (matches groupBy mode) */
  timeField?: 'createdAt' | 'updatedAt';
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function SessionItem({
  session,
  isActive,
  projectName,
  projectColor,
  isCwdFolder,
  timeField = 'updatedAt',
  onSelect,
  onDelete,
}: SessionItemProps) {
  const timeAgoLabel = useMemo(() => {
    const ts = timeField === 'createdAt' ? session.createdAt : session.updatedAt;
    return timeAgo(ts);
  }, [session.updatedAt, session.createdAt, timeField]);

  const sessionType = (session.metadata?.type as SessionType) ?? 'chat';
  const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
  const lifecycleState = lifecycle?.state ?? 'created';
  const dotColor = STATE_DOT_COLOR[lifecycleState];

  const isCC = session.metadata?.source === 'claude-code';
  const title = deriveTitle(session);

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
      className={`session-item group mx-1.5 px-2 py-2 cursor-pointer rounded-lg transition-colors overflow-hidden ${
        isActive
          ? 'bg-neutral-fg/[0.06]'
          : 'hover:bg-neutral-bg-dim/50'
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
      {/* Row 1: status dot + time */}
      <div className="flex items-start gap-2">
        <span className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm leading-snug line-clamp-2 ${
              isActive ? 'font-medium' : ''
            }`} title={title}>
              {title}
            </span>
            <span className="text-[11px] text-neutral-fg-subtle/60 tabular-nums shrink-0">
              {timeAgoLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: project / folder */}
      {projectName && (
        <div className="flex items-center mt-0.5 pl-5">
          {isCwdFolder ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-neutral-fg-subtle/40 truncate">
              <Folder className="h-2.5 w-2.5 shrink-0" />
              {projectName}
            </span>
          ) : (
            <Badge
              variant="soft"
              className="h-[18px] px-1.5 py-0 text-[10px] rounded font-medium truncate max-w-[160px]"
              style={projectColor ? {
                backgroundColor: `${projectColor}18`,
                color: projectColor,
              } : undefined}
            >
              {projectName}
            </Badge>
          )}
        </div>
      )}

      {/* Row 3: badges + delete */}
      <div className="flex items-center gap-1 mt-1 pl-4">
        {typeLabel && (
          <Badge variant="soft" color={TYPE_BADGE_COLOR[sessionType]} className="h-[18px] px-1.5 py-0 text-[10px] rounded">
            {typeLabel}
          </Badge>
        )}
        {isCC && (
          <Badge variant="soft" color="default" className="h-[18px] px-1.5 py-0 text-[10px] rounded gap-0.5" style={{ backgroundColor: `${CLAUDE_COLOR}18`, color: CLAUDE_COLOR }}>
            <ClaudeIcon className="h-2.5 w-2.5" />
            Claude
          </Badge>
        )}
        {session.parentId && (
          <Badge variant="outline" className="h-[18px] px-1.5 py-0 text-[10px] rounded">
            fork
          </Badge>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 -mr-1 shrink-0 text-neutral-fg-subtle hover:text-palette-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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

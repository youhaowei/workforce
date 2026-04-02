/**
 * BoardColumn - A single status column in the Board view.
 */

import { AgentCard } from './AgentCard';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { stateVariant } from '@/ui/lib/stateVariant';
import type { SessionSummary } from '@/services/types';

export interface BoardColumnProps {
  title: string;
  sessions: SessionSummary[];
  state: string;
  onCardClick?: (sessionId: string) => void;
  onCardAction?: (sessionId: string, action: 'pause' | 'resume' | 'cancel') => void;
}

export function BoardColumn({ title, sessions, state, onCardClick, onCardAction }: BoardColumnProps) {
  return (
    <div className="flex-1 min-w-[240px] flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-neutral-bg-dim">
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge {...stateVariant(state)} className="text-[10px] h-5">
          {sessions.length}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 px-1 pb-2">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <AgentCard
                key={session.id}
                session={session}
                onClick={onCardClick}
                onAction={onCardAction}
              />
            ))
          ) : (
            <p className="text-xs text-neutral-fg-subtle text-center py-4">No agents</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

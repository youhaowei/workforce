/**
 * SessionList - Virtualized list of sessions with search and filtering.
 *
 * Applies type and state filters from SessionsPanel.
 */

import { useState, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus } from 'lucide-react';
import type { Session, SessionLifecycle, SessionType } from '@services/types';
import { SessionItem } from './SessionItem';

export interface SessionListProps {
  sessions: Session[];
  activeSessionId?: string;
  typeFilter?: string;
  stateFilter?: string;
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onFork?: (sessionId: string) => void;
  onCreate?: () => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  typeFilter = 'all',
  stateFilter = 'all',
  onSelect,
  onDelete,
  onFork,
  onCreate,
}: SessionListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredSessions = useMemo(() => {
    let result = sessions;

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((s) => {
        const type = (s.metadata?.type as SessionType) ?? 'chat';
        return type === typeFilter;
      });
    }

    // State filter
    if (stateFilter !== 'all') {
      result = result.filter((s) => {
        const lifecycle = s.metadata?.lifecycle as SessionLifecycle | undefined;
        return lifecycle?.state === stateFilter;
      });
    }

    // Search filter
    const query = debouncedQuery.toLowerCase().trim();
    if (query) {
      result = result.filter((session) => {
        if (session.title?.toLowerCase().includes(query)) return true;
        const goal = session.metadata?.goal as string | undefined;
        if (goal?.toLowerCase().includes(query)) return true;
        return session.messages.some((msg) =>
          msg.content.toLowerCase().includes(query),
        );
      });
    }

    return result;
  }, [debouncedQuery, sessions, typeFilter, stateFilter]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with search and new button */}
      <div className="p-3 border-b space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button size="sm" className="h-8" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
          {debouncedQuery && <span> matching &ldquo;{debouncedQuery}&rdquo;</span>}
        </p>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        {filteredSessions.length > 0 ? (
          filteredSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={onSelect}
              onDelete={onDelete}
              onFork={onFork}
            />
          ))
        ) : (
          <div className="p-4 text-center text-muted-foreground text-sm">
            {debouncedQuery
              ? 'No sessions match your search'
              : 'No sessions yet'}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

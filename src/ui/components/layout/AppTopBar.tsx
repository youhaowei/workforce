import React from 'react';
import { Badge, Button, Separator } from '@ui/components/ui';

interface AppTopBarProps {
  activeSessionLabel: string;
  sessionsOpen: boolean;
  todosOpen: boolean;
  sessionCount: number;
  todoCount: number;
  pendingTodoCount: number;
  onCreateSession: () => void;
  onToggleSessions: () => void;
  onToggleTodos: () => void;
}

export default function AppTopBar(props: AppTopBarProps): React.ReactElement {
  return (
    <header className="border-b border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Active Session</div>
          <div className="truncate text-sm font-medium text-zinc-900">{props.activeSessionLabel}</div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" onClick={props.onCreateSession}>
            New Session
          </Button>
          <Button
            type="button"
            variant={props.sessionsOpen ? 'secondary' : 'outline'}
            onClick={props.onToggleSessions}
          >
            Sessions ({props.sessionCount})
          </Button>
          <Button type="button" variant={props.todosOpen ? 'secondary' : 'outline'} onClick={props.onToggleTodos}>
            Todos ({props.pendingTodoCount}/{props.todoCount})
          </Button>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Badge variant="outline">{props.pendingTodoCount} pending</Badge>
        </div>
      </div>
    </header>
  );
}

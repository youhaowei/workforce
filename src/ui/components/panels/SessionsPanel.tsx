import React from 'react';
import type { SessionListItem } from '@ui/types/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@ui/components/ui';
import { cn } from '@ui/lib/utils';

interface SessionsPanelProps {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  onCreate: () => void;
  onResume: (id: string) => Promise<void>;
  onFork: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function SessionsPanel(props: SessionsPanelProps): React.ReactElement {
  return (
    <aside className="w-80 border-r border-zinc-200 bg-zinc-50/50">
      <div className="flex items-center justify-between border-b border-zinc-200 p-3">
        <h2 className="font-semibold text-zinc-900">Sessions</h2>
        <Button onClick={props.onClose} title="Close" type="button" variant="ghost" size="sm">
          ✕
        </Button>
      </div>
      <div className="space-y-3 p-3">
        <Button className="w-full" onClick={props.onCreate}>
          New Session
        </Button>
        {props.sessions.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white p-2 text-sm text-zinc-500">
            No sessions yet. Create one to start tracking chat history.
          </div>
        ) : null}
        {props.sessions.map((session) => (
          <Card
            key={session.id}
            className={cn(
              'text-sm',
              props.activeSessionId === session.id
                ? 'border-zinc-400'
                : 'border-zinc-200'
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{session.title ?? session.id}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Badge variant={props.activeSessionId === session.id ? 'secondary' : 'outline'}>
                {props.activeSessionId === session.id ? 'Open' : 'Resume'}
              </Badge>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void props.onResume(session.id)}>
                  {props.activeSessionId === session.id ? 'Open' : 'Resume'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void props.onFork(session.id)}>
                  Fork
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void props.onDelete(session.id)}>
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </aside>
  );
}

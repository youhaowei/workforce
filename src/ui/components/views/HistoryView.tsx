import React from 'react';
import type { EventItem } from '@ui/types/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui';

interface HistoryViewProps {
  events: EventItem[];
}

export default function HistoryView(props: HistoryViewProps): React.ReactElement {
  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">History / Audit</h2>
      <div className="space-y-2">
        {props.events.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
            No history events yet.
          </div>
        ) : null}
        {props.events.map((event) => (
          <Card key={event.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
              {event.stream} · {event.action}
              </CardTitle>
              <CardDescription>Entity: {event.entityId}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <pre className="mt-2 overflow-auto rounded bg-zinc-100 p-2 text-xs">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

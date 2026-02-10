import React, { useState } from 'react';
import type { TodoItem } from '@ui/types/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@ui/components/ui';

interface TodosPanelProps {
  todos: TodoItem[];
  onCreate: (title: string) => void;
  onUpdateStatus: (id: string, status: TodoItem['status']) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function TodosPanel(props: TodosPanelProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const pendingCount = props.todos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress'
  ).length;

  return (
    <aside className="w-80 border-l border-zinc-200 bg-zinc-50/50">
      <div className="flex items-center justify-between border-b border-zinc-200 p-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-zinc-900">Todos</h2>
          <Badge variant="outline">{pendingCount} pending</Badge>
        </div>
        <Button onClick={props.onClose} title="Close" type="button" variant="ghost" size="sm">
          ✕
        </Button>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a todo..."
            className="flex-1"
          />
          <Button
            onClick={() => {
              if (!title.trim()) return;
              props.onCreate(title.trim());
              setTitle('');
            }}
            disabled={!title.trim()}
          >
            Add
          </Button>
        </div>
        {props.todos.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white p-2 text-sm text-zinc-500">
            No todos yet.
          </div>
        ) : null}
        {props.todos.map((todo) => (
          <Card key={todo.id} className="text-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{todo.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-2">
                <Badge variant={todo.status === 'completed' ? 'success' : 'outline'}>{todo.status}</Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => props.onUpdateStatus(todo.id, 'completed')}
                >
                  Complete
                </Button>
                <Button size="sm" variant="destructive" onClick={() => props.onDelete(todo.id)}>
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

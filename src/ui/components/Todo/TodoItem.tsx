/**
 * TodoItem - Individual todo with status indicator and hover actions.
 */

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Check, XCircle, Trash2, Circle, CircleDot, CheckCircle } from 'lucide-react';
import type { Todo, TodoStatus } from '../../../services/types';

export interface TodoItemProps {
  todo: Todo;
  onStatusChange?: (todoId: string, status: TodoStatus) => void;
  onDelete?: (todoId: string) => void;
}

function statusColor(status: TodoStatus): string {
  if (status === 'in_progress' || status === 'completed') return 'text-primary';
  if (status === 'cancelled') return 'text-destructive';
  return 'text-muted-foreground';
}

const STATUS_ICON: Record<TodoStatus, typeof Circle> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle,
  cancelled: XCircle,
};

export function TodoItem({ todo, onStatusChange, onDelete }: TodoItemProps) {
  const StatusIcon = STATUS_ICON[todo.status];

  const timeAgo = useMemo(() => {
    const diff = Date.now() - todo.updatedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [todo.updatedAt]);

  const canStart = todo.status === 'pending';
  const canComplete = todo.status === 'pending' || todo.status === 'in_progress';
  const canCancel = todo.status === 'pending' || todo.status === 'in_progress';
  const isDone = todo.status === 'completed' || todo.status === 'cancelled';

  return (
    <div
      className={`group flex items-start gap-2 p-2 rounded hover:bg-accent ${
        isDone ? 'opacity-60' : ''
      }`}
    >
      {/* Status indicator */}
      <StatusIcon
        className={`h-4 w-4 mt-0.5 flex-shrink-0 ${statusColor(todo.status)}`}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${todo.status === 'completed' ? 'line-through' : ''}`}>
          {todo.title}
        </div>
        {todo.description && (
          <div className="text-xs text-muted-foreground truncate">{todo.description}</div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">{timeAgo}</div>
      </div>

      {/* Actions - visible on hover */}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {canStart && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onStatusChange?.(todo.id, 'in_progress')} title="Start">
            <Play className="h-3 w-3" />
          </Button>
        )}
        {canComplete && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onStatusChange?.(todo.id, 'completed')} title="Complete">
            <Check className="h-3 w-3" />
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onStatusChange?.(todo.id, 'cancelled')} title="Cancel">
            <XCircle className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete?.(todo.id)} title="Delete">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

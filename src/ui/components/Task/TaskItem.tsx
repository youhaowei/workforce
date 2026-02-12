/**
 * TaskItem - Individual task with status indicator and hover actions.
 */

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Check, XCircle, Trash2, Circle, CircleDot, CheckCircle } from 'lucide-react';
import type { Task, TaskStatus } from '../../../services/types';

export interface TaskItemProps {
  task: Task;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
  onDelete?: (taskId: string) => void;
}

function statusColor(status: TaskStatus): string {
  if (status === 'in_progress' || status === 'completed') return 'text-primary';
  if (status === 'cancelled') return 'text-destructive';
  return 'text-muted-foreground';
}

const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle,
  cancelled: XCircle,
};

export function TaskItem({ task, onStatusChange, onDelete }: TaskItemProps) {
  const StatusIcon = STATUS_ICON[task.status];

  const timeAgo = useMemo(() => {
    const diff = Date.now() - task.updatedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [task.updatedAt]);

  const canStart = task.status === 'pending';
  const canComplete = task.status === 'pending' || task.status === 'in_progress';
  const canCancel = task.status === 'pending' || task.status === 'in_progress';
  const isDone = task.status === 'completed' || task.status === 'cancelled';

  return (
    <div
      className={`group flex items-start gap-2 p-2 rounded hover:bg-accent ${
        isDone ? 'opacity-60' : ''
      }`}
    >
      {/* Status indicator */}
      <StatusIcon
        className={`h-4 w-4 mt-0.5 flex-shrink-0 ${statusColor(task.status)}`}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${task.status === 'completed' ? 'line-through' : ''}`}>
          {task.title}
        </div>
        {task.description && (
          <div className="text-xs text-muted-foreground truncate">{task.description}</div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">{timeAgo}</div>
      </div>

      {/* Actions - visible on hover */}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {canStart && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onStatusChange?.(task.id, 'in_progress')} title="Start">
            <Play className="h-3 w-3" />
          </Button>
        )}
        {canComplete && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onStatusChange?.(task.id, 'completed')} title="Complete">
            <Check className="h-3 w-3" />
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onStatusChange?.(task.id, 'cancelled')} title="Cancel">
            <XCircle className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete?.(task.id)} title="Delete">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

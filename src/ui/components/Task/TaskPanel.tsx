/**
 * TaskPanel - Side panel for task management.
 */

import { useState, useMemo, useCallback, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';
import type { TaskStatus } from '../../../services/types';
import { useTRPC } from '@/bridge/react';
import { TaskList } from './TaskList';

export interface TaskPanelProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function TaskPanel({ isOpen, onClose }: TaskPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const { data: tasks = [] } = useQuery(
    trpc.task.list.queryOptions(undefined, {
      enabled: isOpen,
      refetchInterval: 2000,
    })
  );

  const invalidateTasks = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: trpc.task.list.queryKey() });
  }, [queryClient, trpc]);

  const createMutation = useMutation(
    trpc.task.create.mutationOptions({
      onSuccess: invalidateTasks,
    })
  );

  const updateStatusMutation = useMutation(
    trpc.task.updateStatus.mutationOptions({
      onSuccess: invalidateTasks,
    })
  );

  const deleteMutation = useMutation(
    trpc.task.delete.mutationOptions({
      onSuccess: invalidateTasks,
    })
  );

  const handleStatusChange = useCallback((taskId: string, status: TaskStatus) => {
    updateStatusMutation.mutate({ id: taskId, status });
  }, [updateStatusMutation]);

  const handleDelete = useCallback((taskId: string) => {
    deleteMutation.mutate({ id: taskId });
  }, [deleteMutation]);

  const handleAddTask = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;

    createMutation.mutate({ title });
    setNewTaskTitle('');
  }, [newTaskTitle, createMutation]);

  const pendingCount = useMemo(
    () =>
      tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress')
        .length,
    [tasks]
  );

  return (
    <div
      data-collapsed={!isOpen}
      className={`flex-shrink-0 flex flex-col panel-surface transition-[width] duration-200 ease-in-out ${
        isOpen ? 'w-80' : 'w-0'
      }`}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          Tasks
          {pendingCount > 0 && (
            <Badge variant="secondary" className="text-xs">{pendingCount}</Badge>
          )}
        </h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Add task form */}
      <form className="p-2 border-b" onSubmit={handleAddTask}>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Add a task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.currentTarget.value)}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" disabled={!newTaskTitle.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      </form>

      {/* Task list */}
      <TaskList
        tasks={tasks}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
      />
    </div>
  );
}

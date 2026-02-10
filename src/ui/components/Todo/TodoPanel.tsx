/**
 * TodoPanel - Side panel for todo management.
 */

import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';
import type { TodoStatus } from '../../../services/types';
import { getTodoService } from '@services/todo';
import { TodoList } from './TodoList';

export interface TodoPanelProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function TodoPanel({ isOpen, onClose }: TodoPanelProps) {
  const [todos, setTodos] = useState(getTodoService().list());
  const [newTodoTitle, setNewTodoTitle] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTodos(getTodoService().list());
    const refreshInterval = setInterval(() => {
      setTodos(getTodoService().list());
    }, 1000);
    return () => {
      clearInterval(refreshInterval);
    };
  }, [isOpen]);

  const handleStatusChange = (todoId: string, status: TodoStatus) => {
    const service = getTodoService();
    switch (status) {
      case 'in_progress':
        service.start(todoId);
        break;
      case 'completed':
        service.complete(todoId);
        break;
      case 'cancelled':
        service.cancel(todoId);
        break;
      default:
        service.update(todoId, { status });
    }
    setTodos(service.list());
  };

  const handleDelete = (todoId: string) => {
    const service = getTodoService();
    service.delete(todoId);
    setTodos(service.list());
  };

  const handleAddTodo = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = newTodoTitle.trim();
    if (!title) return;

    const service = getTodoService();
    service.create(title);
    setNewTodoTitle('');
    setTodos(service.list());
  };

  const pendingCount = useMemo(
    () =>
      todos.filter((t) => t.status === 'pending' || t.status === 'in_progress')
        .length,
    [todos]
  );

  if (!isOpen) return null;

  return (
    <div className="w-80 border-l bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          Todos
          {pendingCount > 0 && (
            <Badge variant="secondary" className="text-xs">{pendingCount}</Badge>
          )}
        </h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Add todo form */}
      <form className="p-2 border-b" onSubmit={handleAddTodo}>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Add a todo..."
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.currentTarget.value)}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" disabled={!newTodoTitle.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      </form>

      {/* Todo list */}
      <TodoList
        todos={todos}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
      />
    </div>
  );
}

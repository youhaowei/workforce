/**
 * TodoList - Filtered list of todos with tab-based filtering.
 */

import { useState, useMemo } from 'react';
import type { Todo, TodoStatus } from '../../../services/types';
import { TodoItem } from './TodoItem';

export interface TodoListProps {
  todos: Todo[];
  onStatusChange?: (todoId: string, status: TodoStatus) => void;
  onDelete?: (todoId: string) => void;
}

type FilterTab = 'all' | 'active' | 'completed';

export function TodoList({ todos, onStatusChange, onDelete }: TodoListProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>('active');

  const filteredTodos = useMemo(() => {
    switch (activeTab) {
      case 'active':
        return todos.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress'
        );
      case 'completed':
        return todos.filter(
          (t) => t.status === 'completed' || t.status === 'cancelled'
        );
      default:
        return todos;
    }
  }, [activeTab, todos]);

  const counts = useMemo(() => ({
    all: todos.length,
    active: todos.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    ).length,
    completed: todos.filter(
      (t) => t.status === 'completed' || t.status === 'cancelled'
    ).length,
  }), [todos]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Done' },
    { key: 'all', label: 'All' },
  ];

  function getEmptyMessage(): string {
    if (activeTab === 'active') return 'No active todos';
    if (activeTab === 'completed') return 'No completed todos';
    return 'No todos yet';
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`px-3 py-2 text-sm font-medium ${
              activeTab === tab.key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="ml-1 text-xs opacity-60">({counts[tab.key]})</span>
          </button>
        ))}
      </div>

      {/* Todo items */}
      <div className="flex-1 overflow-y-auto">
        {filteredTodos.length > 0 ? (
          <div className="divide-y">
            {filteredTodos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onStatusChange={onStatusChange}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            {getEmptyMessage()}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * TaskList - Filtered list of tasks with tab-based filtering.
 */

import { useState, useMemo } from 'react';
import type { Task, TaskStatus } from '../../../services/types';
import { TaskItem } from './TaskItem';

export interface TaskListProps {
  tasks: Task[];
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
  onDelete?: (taskId: string) => void;
}

type FilterTab = 'all' | 'active' | 'completed';

export function TaskList({ tasks, onStatusChange, onDelete }: TaskListProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>('active');

  const filteredTasks = useMemo(() => {
    switch (activeTab) {
      case 'active':
        return tasks.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress'
        );
      case 'completed':
        return tasks.filter(
          (t) => t.status === 'completed' || t.status === 'cancelled'
        );
      default:
        return tasks;
    }
  }, [activeTab, tasks]);

  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    ).length,
    completed: tasks.filter(
      (t) => t.status === 'completed' || t.status === 'cancelled'
    ).length,
  }), [tasks]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Done' },
    { key: 'all', label: 'All' },
  ];

  function getEmptyMessage(): string {
    if (activeTab === 'active') return 'No active tasks';
    if (activeTab === 'completed') return 'No completed tasks';
    return 'No tasks yet';
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

      {/* Task items */}
      <div className="flex-1 overflow-y-auto">
        {filteredTasks.length > 0 ? (
          <div className="divide-y">
            {filteredTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
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

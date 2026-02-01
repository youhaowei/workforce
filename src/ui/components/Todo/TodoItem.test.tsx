import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TodoItem } from './TodoItem';
import type { Todo } from '../../../services/types';

describe('TodoItem', () => {
  const mockOnStatusChange = vi.fn();
  const mockOnDelete = vi.fn();

  const baseTodo: Todo = {
    id: 'todo_1',
    title: 'Test Todo',
    status: 'pending',
    priority: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    mockOnStatusChange.mockClear();
    mockOnDelete.mockClear();
  });

  it('renders todo title', () => {
    render(() => <TodoItem todo={baseTodo} />);
    expect(screen.getByText('Test Todo')).toBeInTheDocument();
  });

  it('shows pending status icon', () => {
    render(() => <TodoItem todo={{ ...baseTodo, status: 'pending' }} />);
    expect(screen.getByText('○')).toBeInTheDocument();
  });

  it('shows in_progress status icon', () => {
    render(() => <TodoItem todo={{ ...baseTodo, status: 'in_progress' }} />);
    expect(screen.getByText('◐')).toBeInTheDocument();
  });

  it('shows completed status icon', () => {
    render(() => <TodoItem todo={{ ...baseTodo, status: 'completed' }} />);
    expect(screen.getByText('●')).toBeInTheDocument();
  });

  it('shows cancelled status icon', () => {
    render(() => <TodoItem todo={{ ...baseTodo, status: 'cancelled' }} />);
    expect(screen.getByText('✕')).toBeInTheDocument();
  });

  it('shows Start button for pending todos', () => {
    render(() => (
      <TodoItem
        todo={{ ...baseTodo, status: 'pending' }}
        onStatusChange={mockOnStatusChange}
      />
    ));
    expect(screen.getByTitle('Start')).toBeInTheDocument();
  });

  it('calls onStatusChange with in_progress when Start clicked', async () => {
    render(() => (
      <TodoItem
        todo={{ ...baseTodo, status: 'pending' }}
        onStatusChange={mockOnStatusChange}
      />
    ));

    await fireEvent.click(screen.getByTitle('Start'));
    expect(mockOnStatusChange).toHaveBeenCalledWith('todo_1', 'in_progress');
  });

  it('shows Complete button for pending and in_progress todos', () => {
    render(() => (
      <TodoItem
        todo={{ ...baseTodo, status: 'in_progress' }}
        onStatusChange={mockOnStatusChange}
      />
    ));
    expect(screen.getByTitle('Complete')).toBeInTheDocument();
  });

  it('calls onStatusChange with completed when Complete clicked', async () => {
    render(() => (
      <TodoItem
        todo={{ ...baseTodo, status: 'in_progress' }}
        onStatusChange={mockOnStatusChange}
      />
    ));

    await fireEvent.click(screen.getByTitle('Complete'));
    expect(mockOnStatusChange).toHaveBeenCalledWith('todo_1', 'completed');
  });

  it('calls onDelete when Delete clicked', async () => {
    render(() => (
      <TodoItem todo={baseTodo} onDelete={mockOnDelete} />
    ));

    await fireEvent.click(screen.getByTitle('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith('todo_1');
  });

  it('hides action buttons for completed todos except delete', () => {
    render(() => (
      <TodoItem
        todo={{ ...baseTodo, status: 'completed' }}
        onStatusChange={mockOnStatusChange}
      />
    ));

    expect(screen.queryByTitle('Start')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Complete')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Cancel')).not.toBeInTheDocument();
    expect(screen.getByTitle('Delete')).toBeInTheDocument();
  });
});

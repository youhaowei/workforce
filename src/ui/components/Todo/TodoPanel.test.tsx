import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TodoPanel } from './TodoPanel';

vi.mock('@services/todo', () => ({
  getTodoService: vi.fn(() => ({
    list: vi.fn(() => []),
    create: vi.fn((content: string) => ({
      id: `todo_${Date.now()}`,
      content,
      status: 'pending' as const,
      priority: 'medium' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    start: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe('TodoPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnClose.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when closed', () => {
    render(() => <TodoPanel isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Todos')).not.toBeInTheDocument();
  });

  it('renders panel when open', () => {
    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
  });

  it('shows close button that calls onClose', async () => {
    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);

    const closeButton = screen.getByTitle('Close');
    await fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('shows add todo form', () => {
    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByPlaceholderText('Add a todo...')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('disables Add button when input is empty', () => {
    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);

    const addButton = screen.getByText('Add');
    expect(addButton).toBeDisabled();
  });

  it('enables Add button when input has content', async () => {
    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);

    const input = screen.getByPlaceholderText('Add a todo...');
    await fireEvent.input(input, { target: { value: 'New task' } });

    const addButton = screen.getByText('Add');
    expect(addButton).not.toBeDisabled();
  });

  it('clears input after adding todo', async () => {
    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);

    const input = screen.getByPlaceholderText('Add a todo...') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'New task' } });

    const form = input.closest('form')!;
    await fireEvent.submit(form);

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('does not add todo with whitespace-only input', async () => {
    const { getTodoService } = await import('@services/todo');
    const mockService = getTodoService();

    render(() => <TodoPanel isOpen={true} onClose={mockOnClose} />);

    const input = screen.getByPlaceholderText('Add a todo...') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '   ' } });

    const form = input.closest('form')!;
    await fireEvent.submit(form);

    expect(mockService.create).not.toHaveBeenCalled();
  });
});

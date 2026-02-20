import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MessageInput from './MessageInput';

// Mock tRPC + React Query so the component doesn't need a real provider
vi.mock('@/bridge/react', () => ({
  useTRPC: () => ({
    agent: {
      supportedModels: {
        queryOptions: () => ({
          queryKey: ['agent', 'supportedModels'],
          queryFn: () => Promise.resolve([]),
        }),
      },
    },
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: undefined, isLoading: false, error: null }),
  };
});

describe('MessageInput', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    mockOnSubmit.mockClear();
    mockOnCancel.mockClear();
    localStorage.clear();
  });

  it('renders with default placeholder', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);
    expect(screen.getByPlaceholderText('Ask Workforce anything...')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(
      <MessageInput
        onSubmit={mockOnSubmit}
        isStreaming={false}
        placeholder="Ask anything..."
      />,
    );
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument();
  });

  it('calls onSubmit with content and agentConfig on Enter', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    const call = mockOnSubmit.mock.calls[0][0];
    expect(call.content).toBe('Hello world');
    expect(call.agentConfig).toEqual({
      model: 'claude-sonnet-4-5-20250929',
      thinkingLevel: 'auto',
      permissionMode: 'default',
    });
  });

  it('does not submit on Shift+Enter (allows multiline)', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('clears input on Escape when not streaming', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Some text' } });
    expect(textarea.value).toBe('Some text');

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(textarea.value).toBe('');
  });

  it('does not call onCancel on Escape when not streaming', () => {
    render(
      <MessageInput
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isStreaming={false}
      />,
    );

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(textarea.value).toBe('');
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('disables textarea during streaming', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={true} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
    expect(textarea).toBeDisabled();
  });

  it('shows Stop button during streaming', () => {
    render(
      <MessageInput
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isStreaming={true}
      />,
    );

    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.queryByTitle('Send (Enter)')).not.toBeInTheDocument();
  });

  it('shows Send button when not streaming', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    expect(screen.getByTitle('Send (Enter)')).toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('disables Send button when input is empty', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const sendButton = screen.getByTitle('Send (Enter)');
    expect(sendButton).toBeDisabled();
  });

  it('enables Send button when input has content', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    const sendButton = screen.getByTitle('Send (Enter)');
    expect(sendButton).not.toBeDisabled();
  });

  it('does not submit empty or whitespace-only input', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('clears input after successful submit', () => {
    render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Ask Workforce anything...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(textarea.value).toBe('');
  });

  it('calls onCancel when Stop button is clicked', () => {
    render(
      <MessageInput
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isStreaming={true}
      />,
    );

    const stopButton = screen.getByText('Stop');
    fireEvent.click(stopButton);

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  describe('config restoration', () => {
    it('restores config from localStorage when no session messages', () => {
      const stored = { model: 'claude-opus-4-6', thinkingLevel: 'high', permissionMode: 'bypassPermissions' };
      localStorage.setItem('agent-config-last', JSON.stringify(stored));

      render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

      const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      const call = mockOnSubmit.mock.calls[0][0];
      expect(call.agentConfig).toEqual(stored);
    });

    it('restores config from session messages over localStorage', () => {
      const storedConfig = { model: 'claude-opus-4-6', thinkingLevel: 'high', permissionMode: 'bypassPermissions' };
      localStorage.setItem('agent-config-last', JSON.stringify(storedConfig));

      const sessionConfig = { model: 'claude-haiku-4-5-20251001', thinkingLevel: 'low' as const, permissionMode: 'plan' as const };
      const messages = [
        { role: 'user' as const, agentConfig: sessionConfig },
        { role: 'assistant' as const },
      ];

      render(
        <MessageInput
          onSubmit={mockOnSubmit}
          isStreaming={false}
          sessionId="sess-1"
          messages={messages}
        />,
      );

      const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      const call = mockOnSubmit.mock.calls[0][0];
      expect(call.agentConfig).toEqual(sessionConfig);
    });

    it('ignores invalid localStorage config and falls back to defaults', () => {
      localStorage.setItem('agent-config-last', JSON.stringify({ model: '', thinkingLevel: 'invalid' }));

      render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

      const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      const call = mockOnSubmit.mock.calls[0][0];
      expect(call.agentConfig).toEqual({
        model: 'claude-sonnet-4-5-20250929',
        thinkingLevel: 'auto',
        permissionMode: 'default',
      });
    });

    it('persists config to localStorage on submit', () => {
      render(<MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

      const textarea = screen.getByPlaceholderText('Ask Workforce anything...');
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      const stored = JSON.parse(localStorage.getItem('agent-config-last')!);
      expect(stored).toEqual({
        model: 'claude-sonnet-4-5-20250929',
        thinkingLevel: 'auto',
        permissionMode: 'default',
      });
    });
  });
});

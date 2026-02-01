import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MessageInput from './MessageInput';

describe('MessageInput', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    mockOnSubmit.mockClear();
    mockOnCancel.mockClear();
  });

  it('renders with default placeholder', () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(() => (
      <MessageInput
        onSubmit={mockOnSubmit}
        isStreaming={false}
        placeholder="Ask anything..."
      />
    ));
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument();
  });

  it('calls onSubmit with trimmed value on Enter', async () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    await fireEvent.input(textarea, { target: { value: '  Hello world  ' } });
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockOnSubmit).toHaveBeenCalledWith('Hello world');
    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Shift+Enter (allows multiline)', async () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    await fireEvent.input(textarea, { target: { value: 'Line 1' } });
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('clears input on Escape when not streaming', async () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'Some text' } });
    expect(textarea.value).toBe('Some text');

    await fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(textarea.value).toBe('');
  });

  it('clears input on Escape when not streaming (disabled textarea cannot receive keyDown)', async () => {
    render(() => (
      <MessageInput
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isStreaming={false}
      />
    ));

    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'Test' } });
    await fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(textarea.value).toBe('');
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('disables textarea during streaming', () => {
    render(() => (
      <MessageInput onSubmit={mockOnSubmit} isStreaming={true} />
    ));

    const textarea = screen.getByPlaceholderText('Type a message...');
    expect(textarea).toBeDisabled();
  });

  it('shows Cancel button during streaming', () => {
    render(() => (
      <MessageInput
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isStreaming={true}
      />
    ));

    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.queryByText('Send')).not.toBeInTheDocument();
  });

  it('shows Send button when not streaming', () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('disables Send button when input is empty', () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const sendButton = screen.getByText('Send');
    expect(sendButton).toBeDisabled();
  });

  it('enables Send button when input has content', async () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    await fireEvent.input(textarea, { target: { value: 'Hello' } });

    const sendButton = screen.getByText('Send');
    expect(sendButton).not.toBeDisabled();
  });

  it('does not submit empty or whitespace-only input', async () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Type a message...');
    await fireEvent.input(textarea, { target: { value: '   ' } });
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('clears input after successful submit', async () => {
    render(() => <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />);

    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'Test message' } });
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(textarea.value).toBe('');
  });

  it('calls onCancel when Cancel button is clicked', async () => {
    render(() => (
      <MessageInput
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isStreaming={true}
      />
    ));

    const cancelButton = screen.getByText('Cancel');
    await fireEvent.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('shows correct hint text based on streaming state', () => {
    const { unmount } = render(() => (
      <MessageInput onSubmit={mockOnSubmit} isStreaming={false} />
    ));
    expect(screen.getByText('Enter to send, Shift+Enter for newline')).toBeInTheDocument();
    unmount();

    render(() => (
      <MessageInput onSubmit={mockOnSubmit} isStreaming={true} />
    ));
    expect(screen.getByText('Press Escape to cancel')).toBeInTheDocument();
  });
});

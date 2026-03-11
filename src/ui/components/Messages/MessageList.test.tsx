import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

// Track scrollToIndex calls through the Virtuoso ref
const mockScrollToIndex = vi.fn();

// Capture Virtuoso callbacks so tests can simulate scroll state changes
let capturedAtBottomStateChange: ((atBottom: boolean) => void) | null = null;

vi.mock('react-virtuoso', () => ({
  Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    capturedAtBottomStateChange = props.atBottomStateChange as typeof capturedAtBottomStateChange;
    const scrollerRefCb = props.scrollerRef as ((el: HTMLElement | null) => void) | undefined;

    // Expose scrollToIndex on the forwarded ref so MessageList's useEffect can call it
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: mockScrollToIndex,
      scrollTo: vi.fn(),
    }));

    return (
      <div
        data-testid="virtuoso-scroller"
        ref={(el: HTMLElement | null) => scrollerRefCb?.(el)}
      >
        {(props.data as Array<{ id: string }>)?.map((msg, i) => (
          <div key={msg.id} data-testid={`message-${i}`}>{msg.id}</div>
        ))}
      </div>
    );
  }),
}));

// Control store values from tests
let mockStoreIsStreaming = false;
let mockActiveSessionId: string | null = null;
vi.mock('@/ui/stores/useMessagesStore', () => ({
  useMessagesStore: (selector: (s: { isStreaming: boolean; activeSessionId: string | null }) => unknown) =>
    selector({ isStreaming: mockStoreIsStreaming, activeSessionId: mockActiveSessionId }),
}));

// Stub MessageItem — we're testing scroll, not message rendering
vi.mock('./MessageItem', () => ({
  default: ({ message }: { message: { id: string } }) => <div>{message.id}</div>,
}));

function makeMessages(count: number, streaming = false) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: 'assistant' as const,
    content: `Message ${i}`,
    timestamp: Date.now(),
    isStreaming: i === count - 1 && streaming,
  }));
}

// Lazy import so mocks are in place before the module loads
const { default: MessageList } = await import('./MessageList');

describe('MessageList scroll behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockStoreIsStreaming = false;
    mockActiveSessionId = null;
    mockScrollToIndex.mockClear();
    capturedAtBottomStateChange = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not force-scroll when user scrolls up during streaming', async () => {
    mockStoreIsStreaming = true;
    const messages = makeMessages(10, true);

    const { rerender } = render(
      <MessageList messages={messages} isStreaming={true} />,
    );

    // Simulate being at bottom initially
    act(() => capturedAtBottomStateChange?.(true));

    // Let the RAF loop start and make initial calls
    await act(async () => { vi.advanceTimersByTime(100); });
    mockScrollToIndex.mockClear(); // clear setup calls

    const scroller = screen.getByTestId('virtuoso-scroller');

    // User scrolls up (wheel event with negative deltaY).
    // In real life, Virtuoso's atBottomStateChange fires ASYNCHRONOUSLY — after
    // layout, not in the same frame as the wheel event. The RAF loop fires before
    // the atBottomStateChange callback, so without explicit wheel-intent detection
    // the loop keeps yanking the user back to bottom.
    fireEvent.wheel(scroller, { deltaY: -100 });

    // DO NOT call atBottomStateChange(false) yet — that's the bug.
    // The RAF loop should respect the wheel event BEFORE Virtuoso's callback arrives.
    mockScrollToIndex.mockClear();

    // Advance a few frames — the RAF loop should NOT force-scroll because
    // the wheel event signaled user intent to scroll up.
    await act(async () => { vi.advanceTimersByTime(100); });

    expect(mockScrollToIndex).not.toHaveBeenCalled();

    // Now Virtuoso catches up and reports not-at-bottom
    act(() => capturedAtBottomStateChange?.(false));
    mockScrollToIndex.mockClear();

    // Rerender with updated streaming content (simulating new tokens arriving)
    const updatedMessages = makeMessages(10, true);
    updatedMessages[9].content = 'Message 9 with more streaming content appended...';
    rerender(<MessageList messages={updatedMessages} isStreaming={true} />);

    await act(async () => { vi.advanceTimersByTime(500); });

    // scrollToIndex should still NOT have been called
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('should show jump-to-bottom button immediately on wheel-up during streaming', () => {
    mockStoreIsStreaming = true;
    const messages = makeMessages(10, true);

    render(<MessageList messages={messages} isStreaming={true} />);

    // Initially at bottom — no button
    act(() => capturedAtBottomStateChange?.(true));
    expect(screen.queryByText('Jump to bottom')).toBeNull();

    // User scrolls up — button should appear immediately on the wheel event,
    // WITHOUT waiting for Virtuoso's async atBottomStateChange callback.
    const scroller = screen.getByTestId('virtuoso-scroller');
    fireEvent.wheel(scroller, { deltaY: -100 });

    expect(screen.getByText('Jump to bottom')).toBeInTheDocument();
  });

  it('should show jump-to-bottom button on wheel-up when NOT streaming', () => {
    mockStoreIsStreaming = false;
    const messages = makeMessages(10, false);

    render(<MessageList messages={messages} isStreaming={false} />);

    act(() => capturedAtBottomStateChange?.(true));
    expect(screen.queryByText('Jump to bottom')).toBeNull();

    const scroller = screen.getByTestId('virtuoso-scroller');
    fireEvent.wheel(scroller, { deltaY: -100 });

    expect(screen.getByText('Jump to bottom')).toBeInTheDocument();
  });

  it('should clear scroll-up state when user returns to bottom', () => {
    mockStoreIsStreaming = true;
    const messages = makeMessages(10, true);

    render(<MessageList messages={messages} isStreaming={true} />);

    // Start at bottom, then scroll up
    act(() => capturedAtBottomStateChange?.(true));
    const scroller = screen.getByTestId('virtuoso-scroller');
    fireEvent.wheel(scroller, { deltaY: -100 });
    act(() => capturedAtBottomStateChange?.(false));

    // Jump button should be visible
    expect(screen.getByText('Jump to bottom')).toBeInTheDocument();

    // User clicks jump to bottom — clears the scroll-up intent
    fireEvent.click(screen.getByText('Jump to bottom'));
    act(() => capturedAtBottomStateChange?.(true));

    // Button should disappear — back at bottom, auto-scroll re-engaged
    expect(screen.queryByText('Jump to bottom')).toBeNull();

    // Scroll up again — should be able to disengage again (not stuck)
    fireEvent.wheel(scroller, { deltaY: -100 });
    act(() => capturedAtBottomStateChange?.(false));
    expect(screen.getByText('Jump to bottom')).toBeInTheDocument();
  });

  it('should reset scroll state when session changes', async () => {
    mockActiveSessionId = 'session-a';
    const messagesA = makeMessages(10);

    const { rerender } = render(
      <MessageList messages={messagesA} isStreaming={false} />,
    );

    // Simulate user scrolling up in session A
    const scroller = screen.getByTestId('virtuoso-scroller');
    fireEvent.wheel(scroller, { deltaY: -100 });
    act(() => capturedAtBottomStateChange?.(false));
    expect(screen.getByText('Jump to bottom')).toBeInTheDocument();

    // Switch to session B — session-change effect resets scroll state
    mockActiveSessionId = 'session-b';
    const messagesB = Array.from({ length: 5 }, (_, i) => ({
      id: `session-b-msg-${i}`,
      role: 'assistant' as const,
      content: `Session B Message ${i}`,
      timestamp: Date.now(),
      isStreaming: false,
    }));
    rerender(<MessageList messages={messagesB} isStreaming={false} />);

    // Jump button should be hidden — session switch resets scroll state
    expect(screen.queryByText('Jump to bottom')).toBeNull();
  });

  it('should show jump-to-bottom button even with only 2 messages', () => {
    const messages = makeMessages(2, false);

    render(<MessageList messages={messages} isStreaming={false} />);

    act(() => capturedAtBottomStateChange?.(true));
    expect(screen.queryByText('Jump to bottom')).toBeNull();

    const scroller = screen.getByTestId('virtuoso-scroller');
    fireEvent.wheel(scroller, { deltaY: -100 });

    expect(screen.getByText('Jump to bottom')).toBeInTheDocument();
  });
});

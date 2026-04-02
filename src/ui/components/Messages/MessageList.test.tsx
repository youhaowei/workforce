import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

// Track scrollToIndex calls through the Virtuoso ref
const mockScrollToIndex = vi.fn();
let latestScrollerElement: HTMLElement | null = null;
const mockScrollTo = vi.fn(({ top }: { top?: number }) => {
  if (latestScrollerElement && typeof top === "number") {
    latestScrollerElement.scrollTop = top;
  }
});
const mockAutoscrollToBottom = vi.fn();

// Capture Virtuoso callbacks so tests can simulate scroll state changes
let capturedAtBottomStateChange: ((atBottom: boolean) => void) | null = null;
let capturedTotalListHeightChanged: (() => void) | null = null;
let lastVirtuosoProps: Record<string, unknown> | null = null;

vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    lastVirtuosoProps = props;
    capturedAtBottomStateChange = props.atBottomStateChange as typeof capturedAtBottomStateChange;
    capturedTotalListHeightChanged =
      props.totalListHeightChanged as typeof capturedTotalListHeightChanged;
    const scrollerRefCb = props.scrollerRef as ((el: HTMLElement | null) => void) | undefined;

    // Expose scrollToIndex on the forwarded ref so MessageList's useEffect can call it
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: mockScrollToIndex,
      scrollTo: mockScrollTo,
      autoscrollToBottom: mockAutoscrollToBottom,
    }));

    return (
      <div
        data-testid="virtuoso-scroller"
        ref={(el: HTMLElement | null) => {
          latestScrollerElement = el;
          scrollerRefCb?.(el);
        }}
      >
        {(props.data as Array<{ id: string }>)?.map((msg, i) => (
          <div key={msg.id} data-testid={`message-${i}`}>
            {msg.id}
          </div>
        ))}
      </div>
    );
  }),
}));

// Control store values from tests
let mockStoreIsStreaming = false;
let mockActiveSessionId: string | null = null;
vi.mock("@/ui/stores/useMessagesStore", () => ({
  useMessagesStore: (
    selector: (s: { isStreaming: boolean; activeSessionId: string | null }) => unknown,
  ) => selector({ isStreaming: mockStoreIsStreaming, activeSessionId: mockActiveSessionId }),
}));

// Stub MessageItem — we're testing scroll, not message rendering
vi.mock("./MessageItem", () => ({
  default: ({ message }: { message: { id: string } }) => <div>{message.id}</div>,
}));

function makeMessages(count: number, streaming = false) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: "assistant" as const,
    content: `Message ${i}`,
    timestamp: Date.now(),
    isStreaming: i === count - 1 && streaming,
  }));
}

// Lazy import so mocks are in place before the module loads
const { default: MessageList } = await import("./MessageList");

describe("MessageList scroll behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockStoreIsStreaming = false;
    mockActiveSessionId = null;
    latestScrollerElement = null;
    mockScrollToIndex.mockClear();
    mockScrollTo.mockClear();
    mockAutoscrollToBottom.mockClear();
    capturedAtBottomStateChange = null;
    capturedTotalListHeightChanged = null;
    lastVirtuosoProps = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not force-scroll when user scrolls up during streaming", async () => {
    mockStoreIsStreaming = true;
    const messages = makeMessages(10, true);

    const { rerender } = render(<MessageList messages={messages} isStreaming={true} />);

    // Simulate being at bottom initially
    act(() => capturedAtBottomStateChange?.(true));

    // Let the RAF loop start and make initial calls
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    mockScrollToIndex.mockClear(); // clear setup calls

    const scroller = screen.getByTestId("virtuoso-scroller");

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
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(mockScrollToIndex).not.toHaveBeenCalled();

    // Now Virtuoso catches up and reports not-at-bottom
    act(() => capturedAtBottomStateChange?.(false));
    mockScrollToIndex.mockClear();

    // Rerender with updated streaming content (simulating new tokens arriving)
    const updatedMessages = makeMessages(10, true);
    updatedMessages[9].content = "Message 9 with more streaming content appended...";
    rerender(<MessageList messages={updatedMessages} isStreaming={true} />);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // scrollToIndex should still NOT have been called
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it("should notify parent with jump handler on wheel-up during streaming", () => {
    mockStoreIsStreaming = true;
    const messages = makeMessages(10, true);
    const onJumpToBottom = vi.fn();

    render(<MessageList messages={messages} isStreaming={true} onJumpToBottom={onJumpToBottom} />);

    // Initially at bottom — handler should be null
    act(() => capturedAtBottomStateChange?.(true));
    expect(onJumpToBottom).toHaveBeenLastCalledWith(null);

    // User scrolls up — handler should be a function
    const scroller = screen.getByTestId("virtuoso-scroller");
    fireEvent.wheel(scroller, { deltaY: -100 });

    expect(onJumpToBottom).toHaveBeenLastCalledWith(expect.any(Function));
  });

  it("should notify parent with jump handler on wheel-up when NOT streaming", () => {
    mockStoreIsStreaming = false;
    const messages = makeMessages(10, false);
    const onJumpToBottom = vi.fn();

    render(<MessageList messages={messages} isStreaming={false} onJumpToBottom={onJumpToBottom} />);

    act(() => capturedAtBottomStateChange?.(true));
    expect(onJumpToBottom).toHaveBeenLastCalledWith(null);

    const scroller = screen.getByTestId("virtuoso-scroller");
    fireEvent.wheel(scroller, { deltaY: -100 });

    expect(onJumpToBottom).toHaveBeenLastCalledWith(expect.any(Function));
  });

  it("should clear jump handler when user returns to bottom", async () => {
    mockStoreIsStreaming = true;
    const messages = makeMessages(10, true);
    const onJumpToBottom = vi.fn();

    render(<MessageList messages={messages} isStreaming={true} onJumpToBottom={onJumpToBottom} />);

    // Start at bottom, then scroll up
    act(() => capturedAtBottomStateChange?.(true));
    const scroller = screen.getByTestId("virtuoso-scroller");
    fireEvent.wheel(scroller, { deltaY: -100 });
    act(() => capturedAtBottomStateChange?.(false));

    // Handler should be a function
    expect(onJumpToBottom).toHaveBeenLastCalledWith(expect.any(Function));

    // Invoke the handler (simulates clicking jump-to-bottom externally)
    const handler = onJumpToBottom.mock.calls[onJumpToBottom.mock.calls.length - 1]?.[0];
    await act(async () => {
      handler?.();
      capturedAtBottomStateChange?.(true);
      vi.advanceTimersByTime(100);
    });

    // Handler should be null again
    expect(onJumpToBottom).toHaveBeenLastCalledWith(null);

    // Scroll up again — should be able to disengage again
    await act(async () => {
      fireEvent.wheel(scroller, { deltaY: -100 });
      capturedAtBottomStateChange?.(false);
      vi.advanceTimersByTime(100);
    });
    expect(onJumpToBottom).toHaveBeenLastCalledWith(expect.any(Function));
  });

  it("should reset jump handler when session changes", async () => {
    mockActiveSessionId = "session-a";
    const messagesA = makeMessages(10);
    const onJumpToBottom = vi.fn();

    const { rerender } = render(
      <MessageList messages={messagesA} isStreaming={false} onJumpToBottom={onJumpToBottom} />,
    );

    // Simulate user scrolling up in session A
    const scroller = screen.getByTestId("virtuoso-scroller");
    fireEvent.wheel(scroller, { deltaY: -100 });
    act(() => capturedAtBottomStateChange?.(false));
    expect(onJumpToBottom).toHaveBeenLastCalledWith(expect.any(Function));

    // Switch to session B
    mockActiveSessionId = "session-b";
    const messagesB = Array.from({ length: 5 }, (_, i) => ({
      id: `session-b-msg-${i}`,
      role: "assistant" as const,
      content: `Session B Message ${i}`,
      timestamp: Date.now(),
      isStreaming: false,
    }));
    rerender(
      <MessageList messages={messagesB} isStreaming={false} onJumpToBottom={onJumpToBottom} />,
    );

    // Handler should be null after session switch
    expect(onJumpToBottom).toHaveBeenLastCalledWith(null);
  });

  it("should notify with jump handler even with only 2 messages", () => {
    const messages = makeMessages(2, false);
    const onJumpToBottom = vi.fn();

    render(<MessageList messages={messages} isStreaming={false} onJumpToBottom={onJumpToBottom} />);

    act(() => capturedAtBottomStateChange?.(true));
    expect(onJumpToBottom).toHaveBeenLastCalledWith(null);

    const scroller = screen.getByTestId("virtuoso-scroller");
    fireEvent.wheel(scroller, { deltaY: -100 });

    expect(onJumpToBottom).toHaveBeenLastCalledWith(expect.any(Function));
  });

  // Scroll-to-bottom behavior (RAF loop, re-mount, settle detection) is tested
  // via visual/E2E tests — unit tests with mocked Virtuoso can't verify real
  // scroll behavior because they test mock behavior, not actual DOM scrolling.

  it("should configure Virtuoso to pre-render enough rows for long scrollback", () => {
    const messages = makeMessages(200, false);

    render(<MessageList messages={messages} isStreaming={false} />);

    expect(lastVirtuosoProps?.computeItemKey).toBeTypeOf("function");
    expect(lastVirtuosoProps?.defaultItemHeight).toBe(96);
    expect(lastVirtuosoProps?.increaseViewportBy).toEqual({ top: 800, bottom: 400 });
    expect(lastVirtuosoProps?.minOverscanItemCount).toBe(8);
    expect(lastVirtuosoProps?.overscan).toEqual({ main: 400, reverse: 800 });
  });
});

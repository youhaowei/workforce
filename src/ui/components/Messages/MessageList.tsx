/**
 * MessageList - Virtualized message list with dynamic heights.
 *
 * Uses react-virtuoso for efficient rendering of 1000+ messages
 * with auto-scroll and "jump to bottom" affordance.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowDown } from 'lucide-react';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import MessageItem, { type ForkInfo } from './MessageItem';

interface MessageListProps {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    isStreaming: boolean;
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>;
  }>;
  isStreaming: boolean;
  forksMap?: Map<string, ForkInfo[]>;
  error?: string | null;
  onDismissError?: () => void;
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
  onSelectSession?: (sessionId: string) => void;
}

export default function MessageList({
  messages, isStreaming, forksMap, error, onDismissError, onRewind, onFork, onSelectSession,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const isAtBottomRef = useRef(true);
  // Synchronous user-intent flag: set immediately on wheel-up / touchmove,
  // cleared when user returns to bottom. Prevents the RAF loop from overriding
  // user scroll before Virtuoso's async atBottomStateChange fires.
  const userScrolledUpRef = useRef(false);
  const storeIsStreaming = useMessagesStore((s) => s.isStreaming);
  const activeSessionId = useMessagesStore((s) => s.activeSessionId);

  const firstMsgId = messages[0]?.id ?? null;

  // Track whether we need to scroll to bottom after Virtuoso finishes layout.
  // Set on session switch or bulk message load; cleared after scroll completes.
  const needsScrollToBottomRef = useRef(false);
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  // Generation counter — incremented on each session switch so stale timeouts
  // from a previous session don't clear the flag for the current session.
  const scrollGenRef = useRef(0);

  // Reset scroll state when switching sessions so stale userScrolledUpRef
  // from the previous session doesn't suppress auto-scroll.
  const prevSessionId = useRef(activeSessionId);
  useEffect(() => {
    if (activeSessionId !== prevSessionId.current) {
      userScrolledUpRef.current = false;
      isAtBottomRef.current = true;
      setShowJumpButton(false);
      needsScrollToBottomRef.current = true;
      scrollGenRef.current++;
      prevSessionId.current = activeSessionId;
    }
  }, [activeSessionId]);

  // When messages are bulk-loaded (session switch / restore), mark that
  // we need to scroll to bottom. The actual scroll happens in
  // handleTotalListHeightChanged once Virtuoso finishes measuring items.
  const prevFirstMsgId = useRef<string | null>(null);
  useEffect(() => {
    if (firstMsgId && firstMsgId !== prevFirstMsgId.current && messages.length > 0) {
      needsScrollToBottomRef.current = true;
    }
    prevFirstMsgId.current = firstMsgId;
  }, [firstMsgId, messages.length]);

  // Virtuoso fires this when total list height changes (items measured/rendered).
  // This is the reliable moment to scroll — Virtuoso has actual item heights.
  // Uses refs instead of closure values so the callback is stable (no deps)
  // and always reads fresh state.
  const handleTotalListHeightChanged = useCallback(() => {
    if (!needsScrollToBottomRef.current || userScrolledUpRef.current) return;
    virtuosoRef.current?.scrollToIndex({
      index: messagesLengthRef.current - 1,
      align: 'end',
      behavior: 'auto',
    });
    // Clear after a short delay — Virtuoso may fire multiple height changes
    // as it measures items progressively. Keep scrolling until stable.
    // Generation counter prevents stale timeouts from a previous session
    // clearing the flag for the current session.
    const gen = scrollGenRef.current;
    setTimeout(() => {
      if (scrollGenRef.current === gen) {
        needsScrollToBottomRef.current = false;
      }
    }, 500);
  }, []);

  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
      if (atBottom) userScrolledUpRef.current = false;
      setShowJumpButton(!atBottom);
    },
    [],
  );

  // Detect user scroll-up intent synchronously via wheel/touch events.
  // Shows the jump-to-bottom button immediately (Virtuoso's atBottomStateChange
  // is async and may not fire when the RAF loop was preventing actual scroll movement).
  // Active in both streaming and non-streaming modes.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledUpRef.current = true;
        setShowJumpButton(true);
      }
    };
    const onTouchMove = () => {
      userScrolledUpRef.current = true;
      setShowJumpButton(true);
    };
    scroller.addEventListener('wheel', onWheel, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Auto-scroll during streaming: streaming tokens expand the existing message
  // (no new items appended), so Virtuoso's followOutput doesn't fire.
  // This RAF loop catches intra-message height growth.
  // Respects user scroll intent via userScrolledUpRef.
  useEffect(() => {
    if (!storeIsStreaming) return;
    let rafId: number;
    const tick = () => {
      if (isAtBottomRef.current && !userScrolledUpRef.current) {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
          behavior: 'auto',
        });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [storeIsStreaming, messages.length]);

  const jumpToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    virtuosoRef.current?.scrollToIndex({
      index: messagesLengthRef.current - 1,
      behavior: 'smooth',
      align: 'end',
    });
  }, []);

  // Stable render function for Virtuoso items
  const renderItem = useCallback(
    (index: number, message: (typeof messages)[number]) => {
      const forks = forksMap?.get(message.id);
      return (
        <MessageItem
          key={message.id}
          message={message}
          messageIndex={index}
          forks={forks}
          onRewind={onRewind}
          onFork={onFork}
          onSelectSession={onSelectSession}
        />
      );
    },
    [forksMap, onRewind, onFork, onSelectSession],
  );

  const virtuosoComponents = useMemo(() => ({
    Header: () => (
      <>
        <div className="h-14" />
        {error && (
          <div className="mx-4 mb-2 px-4 py-2 bg-palette-danger/10 border border-palette-danger/20 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-palette-danger shrink-0" />
              <span className="text-sm text-palette-danger">{error}</span>
            </div>
            {onDismissError && (
              <Button variant="ghost" size="sm" onClick={onDismissError} className="text-palette-danger h-7 shrink-0">
                Dismiss
              </Button>
            )}
          </div>
        )}
      </>
    ),
    Footer: () => <div className="h-52" />,
  }), [error, onDismissError]);

  // Empty state is handled by the parent (SessionsView)
  if (messages.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {/* Top fade — always visible */}
      <div className="message-list-fade-top" />
      {/* Bottom fade removed — floating glass input provides the visual boundary */}

      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={(ref) => { scrollerRef.current = ref as HTMLElement; }}
        data={messages}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        atBottomThreshold={100}
        atBottomStateChange={handleAtBottomStateChange}
        totalListHeightChanged={handleTotalListHeightChanged}
        // followOutput handles non-streaming new messages (item appended).
        // Streaming uses the RAF loop above (intra-message growth, no new items).
        // Session switch uses totalListHeightChanged (bulk load with layout sync).
        followOutput="smooth"
        overscan={200}
        components={virtuosoComponents}
        itemContent={renderItem}
        className="flex-1"
      />

      {showJumpButton && (
        <Button
          size="sm"
          onClick={jumpToBottom}
          className="absolute bottom-48 right-4 rounded-full shadow-lg z-10"
        >
          <ArrowDown className="h-3.5 w-3.5 mr-1.5" />
          Jump to bottom
        </Button>
      )}
    </div>
  );
}

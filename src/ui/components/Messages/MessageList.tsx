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
  const prevFirstMsgId = useRef<string | null>(null);
  const isAtBottomRef = useRef(true);
  // Synchronous user-intent flag: set immediately on wheel-up / touchmove,
  // cleared when user returns to bottom. Prevents the RAF loop from overriding
  // user scroll before Virtuoso's async atBottomStateChange fires.
  const userScrolledUpRef = useRef(false);
  const storeIsStreaming = useMessagesStore((s) => s.isStreaming);
  const firstMsgId = messages[0]?.id ?? null;

  // When messages are bulk-loaded (session switch / restore), scroll to bottom.
  // Depends only on the first message ID — streaming appends don't change it.
  useEffect(() => {
    if (firstMsgId && firstMsgId !== prevFirstMsgId.current && messages.length > 0) {
      // Use requestAnimationFrame so Virtuoso has time to measure item heights
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
        });
      });
    }
    prevFirstMsgId.current = firstMsgId;
  }, [firstMsgId, messages.length]);

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

  // Auto-scroll during streaming: height changes in the streaming message
  // don't trigger Virtuoso's followOutput, so we poll while at bottom.
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
      index: messages.length - 1,
      behavior: 'smooth',
      align: 'end',
    });
  }, [messages.length]);

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

/**
 * MessageList - Virtualized message list with dynamic heights.
 *
 * Uses react-virtuoso for efficient rendering of 1000+ messages
 * with auto-scroll and "jump to bottom" affordance.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Button } from '@/components/ui/button';
import { ArrowDown } from 'lucide-react';
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
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
  onSelectSession?: (sessionId: string) => void;
}

export default function MessageList({
  messages, isStreaming, forksMap, onRewind, onFork, onSelectSession,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const prevFirstMsgId = useRef<string | null>(null);
  const isAtBottomRef = useRef(true);
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
      setShowJumpButton(!atBottom && messages.length > 3);
    },
    [messages.length],
  );

  // Auto-scroll during streaming: height changes in the streaming message
  // don't trigger Virtuoso's followOutput, so we poll while at bottom.
  useEffect(() => {
    if (!storeIsStreaming || !isAtBottomRef.current) return;
    let rafId: number;
    const tick = () => {
      if (isAtBottomRef.current) {
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

  // Empty state is handled by the parent (SessionsView)
  if (messages.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 overflow-hidden relative"
      style={{
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 56px, black calc(100% - 56px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 56px, black calc(100% - 56px), transparent 100%)',
      }}
    >
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        atBottomThreshold={100}
        atBottomStateChange={handleAtBottomStateChange}
        followOutput="smooth"
        overscan={200}
        components={{ Header: () => <div className="h-14" /> }}
        itemContent={renderItem}
        className="flex-1"
      />

      {showJumpButton && (
        <Button
          size="sm"
          onClick={jumpToBottom}
          className="absolute bottom-4 right-4 rounded-full shadow-lg z-10"
        >
          <ArrowDown className="h-3.5 w-3.5 mr-1.5" />
          Jump to bottom
        </Button>
      )}
    </div>
  );
}

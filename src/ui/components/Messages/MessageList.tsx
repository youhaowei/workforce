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
import MessageItem from './MessageItem';

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
}

export default function MessageList({ messages, isStreaming }: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const prevFirstMsgId = useRef<string | null>(null);
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
      setShowJumpButton(!atBottom && messages.length > 3);
    },
    [messages.length],
  );

  const jumpToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: 'smooth',
      align: 'end',
    });
  }, [messages.length]);

  // Empty state is handled by the parent (SessionsView)
  if (messages.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        atBottomThreshold={100}
        atBottomStateChange={handleAtBottomStateChange}
        followOutput="smooth"
        overscan={200}
        components={{ Header: () => <div className="h-14" /> }}
        itemContent={(_index, message) => <MessageItem key={message.id} message={message} />}
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

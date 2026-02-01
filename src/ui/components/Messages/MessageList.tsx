/**
 * MessageList - Virtualized message list with auto-scroll
 *
 * Features:
 * - Virtual scrolling for 10k+ messages without jank
 * - Auto-scroll when at bottom (within 100px threshold)
 * - "Jump to bottom" button when scrolled up
 * - Streaming message appended at bottom
 */

import { createSignal, createEffect, onMount, Show, onCleanup, createMemo } from 'solid-js';
import { VirtualList } from '@solid-primitives/virtual';
import MessageItem from './MessageItem';
import StreamingMessage from './StreamingMessage';
import type { MessageState } from '@ui/stores/messagesStore';

interface MessageListProps {
  messages: MessageState[];
  isStreaming: boolean;
}

const styles = {
  container: 'flex-1 overflow-hidden relative flex flex-col',
  scrollArea: 'flex-1 overflow-y-auto',
  jumpButton:
    'absolute bottom-4 right-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-full shadow-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 z-10',
  emptyState: 'flex items-center justify-center h-full text-gray-400',
  streamingSection: 'flex-shrink-0',
};

const AT_BOTTOM_THRESHOLD = 100;
const ESTIMATED_MESSAGE_HEIGHT = 120;

export default function MessageList(props: MessageListProps) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const [showJumpButton, setShowJumpButton] = createSignal(false);
  const [containerHeight, setContainerHeight] = createSignal(400);

  // Check if user is at bottom
  const checkScrollPosition = () => {
    const container = scrollContainer();
    if (container) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distanceFromBottom <= AT_BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
      setShowJumpButton(!atBottom && props.messages.length > 5);
    }
  };

  // Auto-scroll on new messages if at bottom
  createEffect(() => {
    const count = props.messages.length;
    const streaming = props.isStreaming;

    // Track dependencies
    if ((count > 0 || streaming) && isAtBottom()) {
      const container = scrollContainer();
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }
  });

  // Update container height on resize
  onMount(() => {
    const container = scrollContainer();
    if (container) {
      container.addEventListener('scroll', checkScrollPosition, { passive: true });

      const updateHeight = () => {
        setContainerHeight(container.clientHeight || 400);
      };

      updateHeight();
      const resizeObserver = new ResizeObserver(updateHeight);
      resizeObserver.observe(container);

      onCleanup(() => {
        container.removeEventListener('scroll', checkScrollPosition);
        resizeObserver.disconnect();
      });
    }
  });

  const jumpToBottom = () => {
    const container = scrollContainer();
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  // Memoize messages for VirtualList
  const messageItems = createMemo(() => props.messages);

  return (
    <div class={styles.container}>
      <Show
        when={props.messages.length > 0 || props.isStreaming}
        fallback={
          <div class={styles.emptyState}>
            <p>No messages yet. Start a conversation!</p>
          </div>
        }
      >
        <div ref={setScrollContainer} class={styles.scrollArea}>
          <VirtualList
            each={messageItems()}
            rootHeight={containerHeight()}
            rowHeight={ESTIMATED_MESSAGE_HEIGHT}
            overscanCount={3}
          >
            {(message, _index) => <MessageItem message={message} />}
          </VirtualList>

          {/* Streaming message at bottom (not virtualized) */}
          <Show when={props.isStreaming}>
            <div class={styles.streamingSection}>
              <StreamingMessage />
            </div>
          </Show>
        </div>
      </Show>

      {/* Jump to bottom button */}
      <Show when={showJumpButton()}>
        <button onClick={jumpToBottom} class={styles.jumpButton}>
          ↓ Jump to bottom
        </button>
      </Show>
    </div>
  );
}

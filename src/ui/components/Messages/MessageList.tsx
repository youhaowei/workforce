/**
 * MessageList - Virtualized message list with dynamic heights
 *
 * Features:
 * - Dynamic row heights (messages vary in length)
 * - Auto-scroll when at bottom
 * - "Jump to bottom" button when scrolled up
 * - Efficient rendering for 1000+ messages
 */

import { createSignal, createEffect, onMount, Show, onCleanup, For } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import MessageItem from './MessageItem';
import type { MessageState } from '@ui/stores/messagesStore';

interface MessageListProps {
  messages: MessageState[];
  isStreaming: boolean;
}

const AT_BOTTOM_THRESHOLD = 100;
const ESTIMATED_MESSAGE_HEIGHT = 100;

export default function MessageList(props: MessageListProps) {
  let scrollContainer: HTMLDivElement | undefined;
  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const [showJumpButton, setShowJumpButton] = createSignal(false);

  // Create virtualizer with dynamic measurement
  const virtualizer = createVirtualizer({
    get count() {
      return props.messages.length;
    },
    getScrollElement: () => scrollContainer ?? null,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    overscan: 5,
    // Enable dynamic measurement
    measureElement: (el) => {
      if (!el) return ESTIMATED_MESSAGE_HEIGHT;
      return el.getBoundingClientRect().height;
    },
  });

  // Check if user is at bottom
  const checkScrollPosition = () => {
    if (scrollContainer) {
      const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      const atBottom = distanceFromBottom <= AT_BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
      setShowJumpButton(!atBottom && props.messages.length > 3);
    }
  };

  // Auto-scroll on new messages if at bottom
  createEffect(() => {
    const count = props.messages.length;
    const streaming = props.isStreaming;

    // Track dependencies
    if ((count > 0 || streaming) && isAtBottom()) {
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  });

  onMount(() => {
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', checkScrollPosition, { passive: true });
      onCleanup(() => {
        scrollContainer?.removeEventListener('scroll', checkScrollPosition);
      });
    }
  });

  const jumpToBottom = () => {
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  // Calculate total height for virtual spacer
  const totalHeight = () => virtualizer.getTotalSize();
  const virtualItems = () => virtualizer.getVirtualItems();

  return (
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      <Show
        when={props.messages.length > 0 || props.isStreaming}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-charcoal-600/50 px-6">
            <div class="text-center">
              <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-burgundy-500/10 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-burgundy-500">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p class="font-serif text-lg text-charcoal-800 mb-1">Start a conversation</p>
              <p class="text-sm">Ask Fuxi anything to begin</p>
            </div>
          </div>
        }
      >
        <div
          ref={scrollContainer}
          class="flex-1 overflow-y-auto min-h-0"
        >
          {/* Virtual container with total height */}
          <div
            style={{
              height: `${totalHeight()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {/* Render only visible items */}
            <For each={virtualItems()}>
              {(virtualItem) => {
                const message = () => props.messages[virtualItem.index];
                return (
                  <div
                    data-index={virtualItem.index}
                    ref={(el) => queueMicrotask(() => virtualizer.measureElement(el))}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <Show when={message()}>
                      <MessageItem message={message()!} />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Jump to bottom button */}
      <Show when={showJumpButton()}>
        <button
          onClick={jumpToBottom}
          class="absolute bottom-4 right-4 px-4 py-2 bg-burgundy-500 text-white text-sm rounded-full shadow-lg hover:bg-burgundy-600 transition-colors z-10"
        >
          ↓ Jump to bottom
        </button>
      </Show>
    </div>
  );
}

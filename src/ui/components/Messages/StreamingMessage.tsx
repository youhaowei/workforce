/**
 * StreamingMessage - Live streaming message display
 *
 * Renders the currently streaming assistant response with:
 * - Cursor animation
 * - Smooth text appearance
 *
 * Reads from the messages store which is updated via HTTP SSE from the server.
 *
 * NOTE: In SolidJS, early returns don't work reactively. Use <Show> for
 * conditional rendering to maintain fine-grained reactivity.
 */

import { Show } from 'solid-js';
import { getStreamingContent, getIsStreaming } from '@ui/stores/messagesStore';

const styles = {
  wrapper: 'py-4 px-6 bg-gray-50',
  container: 'max-w-3xl mx-auto',
  header: 'flex items-center gap-2 mb-2',
  role: 'text-xs font-semibold uppercase tracking-wider text-green-600',
  status: 'text-xs text-gray-400 flex items-center gap-1',
  spinner: 'w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin',
  content: 'text-sm leading-relaxed text-gray-800 whitespace-pre-wrap border-l-2 border-green-500 pl-3',
  cursor: 'inline-block w-2 h-4 bg-green-500 animate-pulse ml-0.5 align-text-bottom',
};

export default function StreamingMessage() {
  // Read from the messages store (updated via HTTP SSE)
  // These return signal accessors - call them in JSX for reactive updates
  const content = getStreamingContent();
  const isStreaming = getIsStreaming();

  return (
    <Show when={content() || isStreaming()}>
      <div class={styles.wrapper}>
        <div class={styles.container}>
          <div class={styles.header}>
            <span class={styles.role}>assistant</span>
            <div class={styles.status}>
              <div class={styles.spinner} />
              <span>streaming...</span>
            </div>
          </div>

          <div class={styles.content}>
            {content()}
            <span class={styles.cursor} />
          </div>
        </div>
      </div>
    </Show>
  );
}

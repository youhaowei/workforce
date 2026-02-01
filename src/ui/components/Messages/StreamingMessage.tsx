/**
 * StreamingMessage - Live streaming message display
 *
 * Renders the currently streaming assistant response with:
 * - Batched token updates (max 30/sec)
 * - Cursor animation
 * - Smooth text appearance
 */

import { useTokenStream } from '@ui/hooks/useEventBus';

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
  const { tokens, isActive } = useTokenStream();

  // Only render if there's content or we're actively streaming
  if (!tokens() && !isActive()) {
    return null;
  }

  return (
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
          {tokens()}
          <span class={styles.cursor} />
        </div>
      </div>
    </div>
  );
}

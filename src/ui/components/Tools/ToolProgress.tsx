/**
 * ToolProgress - Running tool indicator with elapsed time
 *
 * Shows a compact progress indicator for tools that are currently executing.
 * Updates elapsed time in real-time.
 */

import { createSignal, createEffect, onCleanup, Show } from 'solid-js';

interface ToolProgressProps {
  toolName: string;
  startTime: number;
  onCancel?: () => void;
}

const styles = {
  container: 'flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md',
  spinner: 'w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0',
  info: 'flex-1 min-w-0',
  toolName: 'font-mono text-sm font-medium text-blue-700 truncate',
  elapsed: 'text-xs text-blue-500',
  cancelButton: 'text-xs text-blue-600 hover:text-blue-800 underline flex-shrink-0',
};

export default function ToolProgress(props: ToolProgressProps) {
  const [elapsed, setElapsed] = createSignal(0);

  createEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - props.startTime);
    }, 100);

    onCleanup(() => clearInterval(interval));
  });

  const formatElapsed = () => {
    const ms = elapsed();
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div class={styles.container}>
      <div class={styles.spinner} />
      <div class={styles.info}>
        <div class={styles.toolName}>{props.toolName}</div>
        <div class={styles.elapsed}>{formatElapsed()}</div>
      </div>
      <Show when={props.onCancel}>
        <button onClick={props.onCancel} class={styles.cancelButton}>
          Cancel
        </button>
      </Show>
    </div>
  );
}

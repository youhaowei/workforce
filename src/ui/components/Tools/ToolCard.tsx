/**
 * ToolCard - Tool status card for active tools display
 *
 * Compact card view for showing tool execution in sidebars or overlays.
 * Links to full ToolOutput when expanded.
 */

import { Show, createMemo } from 'solid-js';
import type { ToolUIState } from '@ui/stores/toolStore';

interface ToolCardProps {
  tool: ToolUIState;
  onClick?: () => void;
}

const styles = {
  card: 'rounded-lg border p-3 transition-all hover:shadow-md cursor-pointer',
  cardPending: 'border-gray-200 bg-gray-50',
  cardRunning: 'border-blue-200 bg-blue-50 shadow-sm',
  cardSuccess: 'border-green-200 bg-green-50',
  cardFailed: 'border-red-200 bg-red-50',
  header: 'flex items-center justify-between',
  toolInfo: 'flex items-center gap-2',
  spinner: 'w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin',
  successIcon: 'w-3 h-3 text-green-500',
  failedIcon: 'w-3 h-3 text-red-500',
  name: 'font-mono text-sm font-medium',
  duration: 'text-xs text-gray-500',
  preview: 'mt-2 text-xs text-gray-600 truncate',
};

function getCardStyles(status: ToolUIState['status']) {
  switch (status) {
    case 'pending':
      return styles.cardPending;
    case 'running':
      return styles.cardRunning;
    case 'success':
      return styles.cardSuccess;
    case 'failed':
    case 'cancelled':
      return styles.cardFailed;
    default:
      return styles.cardPending;
  }
}

export default function ToolCard(props: ToolCardProps) {
  const cardStyle = createMemo(() => getCardStyles(props.tool.status));

  const formatDuration = (duration?: number) => {
    if (duration === undefined) return null;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  const getPreview = (): string => {
    if (props.tool.error) {
      return `Error: ${props.tool.error}`;
    }
    if (props.tool.result !== undefined) {
      const str = typeof props.tool.result === 'string'
        ? props.tool.result
        : JSON.stringify(props.tool.result);
      return str.slice(0, 100) + (str.length > 100 ? '...' : '');
    }
    if (props.tool.args) {
      return `Args: ${JSON.stringify(props.tool.args).slice(0, 80)}...`;
    }
    return '';
  };

  return (
    <div class={`${styles.card} ${cardStyle()}`} onClick={props.onClick}>
      <div class={styles.header}>
        <div class={styles.toolInfo}>
          <Show when={props.tool.status === 'running'}>
            <div class={styles.spinner} />
          </Show>
          <Show when={props.tool.status === 'success'}>
            <svg class={styles.successIcon} viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </Show>
          <Show when={props.tool.status === 'failed' || props.tool.status === 'cancelled'}>
            <svg class={styles.failedIcon} viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </Show>
          <span class={styles.name}>{props.tool.name}</span>
        </div>
        <Show when={props.tool.duration}>
          <span class={styles.duration}>{formatDuration(props.tool.duration)}</span>
        </Show>
      </div>
      <Show when={getPreview()}>
        <div class={styles.preview}>{getPreview()}</div>
      </Show>
    </div>
  );
}

/**
 * ToolOutput - Tool execution status and output display
 *
 * Renders tool status with:
 * - Status badges (pending, running, success, failed)
 * - Formatted output per tool type (file, bash, search)
 * - Expandable/collapsible sections
 * - Elapsed time for running tools
 */

import { Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import type { ToolUIStatus } from '@ui/stores/toolStore';
import { formatToolResult } from '@ui/formatters';

interface ToolOutputProps {
  toolId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: string;
  status: ToolUIStatus | 'success' | 'running';
  duration?: number;
  startTime?: number;
}

const styles = {
  container: 'border rounded-md overflow-hidden text-sm',
  containerPending: 'border-gray-300 bg-gray-50',
  containerRunning: 'border-blue-300 bg-blue-50',
  containerSuccess: 'border-green-300 bg-green-50',
  containerFailed: 'border-red-300 bg-red-50',
  header: 'flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-opacity-80',
  headerLeft: 'flex items-center gap-2 flex-1 min-w-0',
  toolName: 'font-mono font-medium truncate',
  status: 'text-xs px-2 py-0.5 rounded-full flex-shrink-0',
  statusPending: 'bg-gray-200 text-gray-600',
  statusRunning: 'bg-blue-200 text-blue-700',
  statusSuccess: 'bg-green-200 text-green-700',
  statusFailed: 'bg-red-200 text-red-700',
  duration: 'text-xs text-gray-500 flex-shrink-0',
  content: 'px-3 py-2 border-t border-gray-200 bg-white',
  summary: 'text-xs text-gray-600 mb-2',
  args: 'font-mono text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap',
  result: 'font-mono text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto',
  error: 'text-xs text-red-600 font-medium',
  spinner: 'w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0',
  expandIcon: 'text-gray-400 text-xs flex-shrink-0',
  argsSection: 'mb-2',
  argsSummary: 'cursor-pointer text-xs text-gray-500 hover:text-gray-700',
};

function getStatusStyles(status: ToolOutputProps['status']) {
  switch (status) {
    case 'pending':
      return { container: styles.containerPending, badge: styles.statusPending };
    case 'running':
      return { container: styles.containerRunning, badge: styles.statusRunning };
    case 'success':
      return { container: styles.containerSuccess, badge: styles.statusSuccess };
    case 'failed':
    case 'cancelled':
      return { container: styles.containerFailed, badge: styles.statusFailed };
    default:
      return { container: styles.containerPending, badge: styles.statusPending };
  }
}

export default function ToolOutput(props: ToolOutputProps) {
  const [isExpanded, setIsExpanded] = createSignal(props.status === 'failed');
  const [elapsedTime, setElapsedTime] = createSignal(0);

  const statusStyles = createMemo(() => getStatusStyles(props.status));

  // Update elapsed time for running tools
  createEffect(() => {
    if (props.status === 'running' && props.startTime) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - props.startTime!);
      }, 100);

      onCleanup(() => clearInterval(interval));
    }
  });

  // Format the result using appropriate formatter
  const formattedResult = createMemo(() => {
    if (props.error) {
      return { summary: '', detail: '', isError: true };
    }
    if (props.result === undefined) {
      return { summary: '', detail: '', isError: false };
    }
    return formatToolResult(props.toolName, props.result);
  });

  const formattedArgs = createMemo(() => {
    try {
      if (!props.args || Object.keys(props.args as object).length === 0) {
        return '';
      }
      return JSON.stringify(props.args, null, 2);
    } catch {
      return String(props.args);
    }
  });

  const displayDuration = createMemo(() => {
    if (props.duration !== undefined) {
      return `${props.duration}ms`;
    }
    if (props.status === 'running' && elapsedTime() > 0) {
      return `${Math.round(elapsedTime() / 100) / 10}s`;
    }
    return null;
  });

  const toggleExpanded = () => {
    setIsExpanded((prev) => !prev);
  };

  const hasContent = createMemo(() => {
    return Boolean(formattedArgs() || formattedResult().detail || props.error);
  });

  return (
    <div class={`${styles.container} ${statusStyles().container}`}>
      {/* Header - clickable to expand/collapse */}
      <div class={styles.header} onClick={toggleExpanded}>
        <div class={styles.headerLeft}>
          <Show when={props.status === 'running'}>
            <div class={styles.spinner} />
          </Show>
          <span class={styles.toolName} title={props.toolName}>
            {props.toolName}
          </span>
          <span class={`${styles.status} ${statusStyles().badge}`}>{props.status}</span>
        </div>

        <div class="flex items-center gap-2">
          <Show when={displayDuration()}>
            <span class={styles.duration}>{displayDuration()}</span>
          </Show>
          <Show when={hasContent()}>
            <span class={styles.expandIcon}>{isExpanded() ? '▼' : '▶'}</span>
          </Show>
        </div>
      </div>

      {/* Expandable Content */}
      <Show when={isExpanded() && hasContent()}>
        <div class={styles.content}>
          {/* Summary line */}
          <Show when={formattedResult().summary}>
            <div class={styles.summary}>{formattedResult().summary}</div>
          </Show>

          {/* Arguments (collapsible) */}
          <Show when={formattedArgs()}>
            <details class={styles.argsSection}>
              <summary class={styles.argsSummary}>Arguments</summary>
              <pre class={styles.args}>{formattedArgs()}</pre>
            </details>
          </Show>

          {/* Error display */}
          <Show when={props.error}>
            <div class={styles.error}>{props.error}</div>
          </Show>

          {/* Result display */}
          <Show when={!props.error && formattedResult().detail}>
            <pre class={styles.result}>{formattedResult().detail}</pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}

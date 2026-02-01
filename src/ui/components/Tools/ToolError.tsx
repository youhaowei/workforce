/**
 * ToolError - Tool error display with details
 *
 * Shows error information with expandable stack trace.
 */

import { Show, createSignal } from 'solid-js';

interface ToolErrorProps {
  toolName: string;
  error: string;
  stackTrace?: string;
  args?: unknown;
}

const styles = {
  container: 'border border-red-200 rounded-md bg-red-50 overflow-hidden',
  header: 'px-3 py-2 flex items-center gap-2',
  icon: 'w-4 h-4 text-red-500 flex-shrink-0',
  title: 'font-mono text-sm font-medium text-red-700',
  message: 'px-3 py-2 text-sm text-red-600 border-t border-red-200 bg-white',
  details: 'px-3 py-2 border-t border-red-200 bg-white',
  detailsToggle: 'text-xs text-red-500 hover:text-red-700 cursor-pointer underline',
  stackTrace: 'mt-2 font-mono text-xs text-red-600 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto bg-red-50 p-2 rounded',
  args: 'mt-2 font-mono text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto',
};

export default function ToolError(props: ToolErrorProps) {
  const [showDetails, setShowDetails] = createSignal(false);

  const hasDetails = () => Boolean(props.stackTrace || props.args);

  return (
    <div class={styles.container}>
      <div class={styles.header}>
        <svg class={styles.icon} viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <span class={styles.title}>{props.toolName} failed</span>
      </div>

      <div class={styles.message}>{props.error}</div>

      <Show when={hasDetails()}>
        <div class={styles.details}>
          <button
            onClick={() => setShowDetails((prev) => !prev)}
            class={styles.detailsToggle}
          >
            {showDetails() ? 'Hide details' : 'Show details'}
          </button>

          <Show when={showDetails()}>
            <Show when={props.stackTrace}>
              <div class={styles.stackTrace}>{props.stackTrace}</div>
            </Show>
            <Show when={props.args}>
              <div class={styles.args}>
                <strong>Arguments:</strong>
                <pre>{JSON.stringify(props.args, null, 2)}</pre>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

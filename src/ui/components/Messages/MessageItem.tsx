/**
 * MessageItem - Individual message display component
 *
 * Renders a single message with role-appropriate styling.
 * Shows tool calls inline when present.
 */

import { Show, For, createMemo } from 'solid-js';
import type { MessageState } from '@ui/stores/messagesStore';
import ToolOutput from '../Tools/ToolOutput';

interface MessageItemProps {
  message: MessageState;
}

const styles = {
  wrapper: 'py-4 px-6',
  wrapperUser: 'bg-white',
  wrapperAssistant: 'bg-gray-50',
  wrapperSystem: 'bg-yellow-50',
  container: 'max-w-3xl mx-auto',
  header: 'flex items-center gap-2 mb-2',
  role: 'text-xs font-semibold uppercase tracking-wider',
  roleUser: 'text-blue-600',
  roleAssistant: 'text-green-600',
  roleSystem: 'text-yellow-600',
  timestamp: 'text-xs text-gray-400',
  content: 'text-sm leading-relaxed text-gray-800 whitespace-pre-wrap',
  streaming: 'border-l-2 border-blue-500 pl-3',
  cursor: 'inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom',
  toolsSection: 'mt-3 space-y-2',
};

export default function MessageItem(props: MessageItemProps) {
  const roleStyles = createMemo(() => {
    switch (props.message.role) {
      case 'user':
        return { wrapper: styles.wrapperUser, role: styles.roleUser };
      case 'assistant':
        return { wrapper: styles.wrapperAssistant, role: styles.roleAssistant };
      case 'system':
        return { wrapper: styles.wrapperSystem, role: styles.roleSystem };
      default:
        return { wrapper: '', role: '' };
    }
  });

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div class={`${styles.wrapper} ${roleStyles().wrapper}`}>
      <div class={styles.container}>
        <div class={styles.header}>
          <span class={`${styles.role} ${roleStyles().role}`}>{props.message.role}</span>
          <span class={styles.timestamp}>{formatTime(props.message.timestamp)}</span>
        </div>

        <div class={`${styles.content} ${props.message.isStreaming ? styles.streaming : ''}`}>
          {props.message.content}
          <Show when={props.message.isStreaming}>
            <span class={styles.cursor} />
          </Show>
        </div>

        <Show when={props.message.toolCalls && props.message.toolCalls.length > 0}>
          <div class={styles.toolsSection}>
            <For each={props.message.toolCalls}>
              {(toolCall) => (
                <ToolOutput
                  toolId={toolCall.id}
                  toolName={toolCall.name}
                  args={toolCall.args}
                  result={props.message.toolResults?.find((r) => r.toolCallId === toolCall.id)?.result}
                  error={props.message.toolResults?.find((r) => r.toolCallId === toolCall.id)?.error}
                  status={
                    props.message.toolResults?.find((r) => r.toolCallId === toolCall.id)
                      ? 'success'
                      : 'running'
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

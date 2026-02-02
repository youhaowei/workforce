/**
 * MessageItem - Individual message display component
 *
 * Harmony-themed message styling:
 * - User messages: Right-aligned, white cards
 * - Assistant messages: Left-aligned, subtle background
 * - Full markdown support
 */

import { Show, For } from 'solid-js';
import type { MessageState } from '@ui/stores/messagesStore';
import { getStreamingContent } from '@ui/stores/messagesStore';
import ToolOutput from '../Tools/ToolOutput';
import Markdown from './Markdown';

interface MessageItemProps {
  message: MessageState;
}

export default function MessageItem(props: MessageItemProps) {
  const streamingContent = getStreamingContent();

  const isUser = () => props.message.role === 'user';

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const displayContent = () =>
    props.message.isStreaming ? streamingContent() : props.message.content;

  return (
    <div
      class={`py-4 px-6 ${isUser() ? '' : 'bg-cream-100/50'}`}
    >
      <div class={`max-w-3xl mx-auto flex ${isUser() ? 'justify-end' : 'justify-start'}`}>
        {/* Message bubble */}
        <div
          class={`relative max-w-[85%] ${
            isUser()
              ? 'bg-burgundy-500 text-white rounded-2xl rounded-br-md px-4 py-3'
              : 'bg-white border border-burgundy-500/10 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm'
          }`}
        >
          {/* Header - name and time */}
          <div class={`flex items-center gap-2 mb-2 text-xs ${
            isUser() ? 'text-white/70 justify-end' : 'text-charcoal-600/60'
          }`}>
            <span class="font-medium">
              {isUser() ? 'You' : 'Fuxi'}
            </span>
            <span>·</span>
            <span>{formatTime(props.message.timestamp)}</span>

            {/* Streaming indicator */}
            <Show when={props.message.isStreaming}>
              <span class="flex items-center gap-1.5 ml-2">
                <span class="w-1.5 h-1.5 rounded-full bg-sage-500 animate-pulse" />
                <span class="text-sage-500">thinking</span>
              </span>
            </Show>
          </div>

          {/* Content */}
          <div class={`text-sm leading-relaxed ${
            props.message.isStreaming ? 'streaming-cursor' : ''
          }`}>
            <Show
              when={!isUser()}
              fallback={<div class="whitespace-pre-wrap">{displayContent()}</div>}
            >
              <Markdown content={displayContent()} />
            </Show>
          </div>

          {/* Tool Calls */}
          <Show when={props.message.toolCalls && props.message.toolCalls.length > 0}>
            <div class="mt-3 space-y-2">
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
    </div>
  );
}

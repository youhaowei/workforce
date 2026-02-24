/**
 * MessageItem - Individual message display with role-based styling.
 */

import { useMemo } from 'react';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import type { ContentBlock, ToolActivity } from '@/services/types';
import ToolOutput from '../Tools/ToolOutput';
import ToolActivityTrace from './ToolActivityTrace';
import ContentBlockRenderer from './ContentBlockRenderer';
import Markdown from './Markdown';

interface MessageItemProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    isStreaming: boolean;
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>;
    toolActivities?: ToolActivity[];
    contentBlocks?: ContentBlock[];
  };
}

function getToolResult(toolCallId: string, toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>) {
  return toolResults?.find((r) => r.toolCallId === toolCallId);
}

function getMessageBoxClass(isUser: boolean): string {
  if (isUser) {
    return 'bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-3';
  }
  return 'bg-card border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm';
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Renders the message body: user text, content blocks, or legacy markdown. */
function MessageContent({ isUser, displayContent, contentBlocks, isStreaming }: {
  isUser: boolean;
  displayContent: string;
  contentBlocks: ContentBlock[];
  isStreaming: boolean;
}) {
  if (isUser) return <div className="whitespace-pre-wrap">{displayContent}</div>;
  if (contentBlocks.length > 0) return <ContentBlockRenderer blocks={contentBlocks} isStreaming={isStreaming} />;
  return (
    <div className={isStreaming ? 'streaming-cursor' : ''}>
      <Markdown content={displayContent} />
    </div>
  );
}

export default function MessageItem({ message }: MessageItemProps) {
  const streamingContent = useMessagesStore((s) => s.streamingContent);
  const streamingBlocks = useMessagesStore((s) => s.streamingBlocks);
  const pendingToolActivities = useMessagesStore((s) => s.pendingToolActivities);
  const currentTool = useMessagesStore((s) => s.currentTool);

  const isUser = message.role === 'user';
  const showTrace = message.isStreaming || (message.toolActivities && message.toolActivities.length > 0);

  const displayContent = useMemo(
    () => (message.isStreaming ? streamingContent : message.content),
    [message.isStreaming, message.content, streamingContent],
  );

  const contentBlocks = useMemo(
    () => (message.isStreaming ? streamingBlocks : message.contentBlocks) ?? [],
    [message.isStreaming, streamingBlocks, message.contentBlocks],
  );
  const hasContentBlocks = contentBlocks.length > 0;

  return (
    <div className={`py-4 px-6 ${isUser ? '' : 'bg-muted/30'}`}>
      <div className={`max-w-3xl mx-auto flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`relative max-w-[85%] ${getMessageBoxClass(isUser)}`}>
          {/* Header */}
          <div
            className={`flex items-center gap-2 mb-2 text-xs ${
              isUser ? 'text-primary-foreground/70 justify-end' : 'text-muted-foreground'
            }`}
          >
            <span className="font-medium">{isUser ? 'You' : 'Workforce'}</span>
            <span>&middot;</span>
            <span>{formatTime(message.timestamp)}</span>
            {showTrace && (
              <span className="ml-2">
                <ToolActivityTrace
                  activities={message.isStreaming ? pendingToolActivities : (message.toolActivities ?? [])}
                  currentTool={message.isStreaming ? currentTool : null}
                  isStreaming={message.isStreaming}
                />
              </span>
            )}
          </div>

          <div className="text-sm leading-relaxed">
            <MessageContent
              isUser={isUser}
              displayContent={displayContent}
              contentBlocks={contentBlocks}
              isStreaming={message.isStreaming}
            />
          </div>

          {/* Legacy tool calls (only for messages without content blocks) */}
          {!hasContentBlocks && message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.toolCalls.map((toolCall) => {
                const toolResult = getToolResult(toolCall.id, message.toolResults);
                return (
                  <ToolOutput
                    key={toolCall.id}
                    toolName={toolCall.name}
                    args={toolCall.args}
                    result={toolResult?.result}
                    error={toolResult?.error}
                    status={toolResult ? 'success' : 'running'}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

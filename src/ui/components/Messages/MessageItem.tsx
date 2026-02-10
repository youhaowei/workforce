/**
 * MessageItem - Individual message display with role-based styling.
 */

import { useMemo } from 'react';
import { useMessagesStore } from '@ui/stores/useMessagesStore';
import ToolOutput from '../Tools/ToolOutput';
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
  };
}

export default function MessageItem({ message }: MessageItemProps) {
  const streamingContent = useMessagesStore((s) => s.streamingContent);

  const isUser = message.role === 'user';

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const displayContent = useMemo(
    () => (message.isStreaming ? streamingContent : message.content),
    [message.isStreaming, message.content, streamingContent],
  );

  return (
    <div className={`py-4 px-6 ${isUser ? '' : 'bg-muted/30'}`}>
      <div className={`max-w-3xl mx-auto flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`relative max-w-[85%] ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-3'
              : 'bg-card border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm'
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center gap-2 mb-2 text-xs ${
              isUser ? 'text-primary-foreground/70 justify-end' : 'text-muted-foreground'
            }`}
          >
            <span className="font-medium">{isUser ? 'You' : 'Workforce'}</span>
            <span>&middot;</span>
            <span>{formatTime(message.timestamp)}</span>
            {message.isStreaming && (
              <span className="flex items-center gap-1.5 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-muted-foreground">thinking</span>
              </span>
            )}
          </div>

          {/* Content */}
          <div className={`text-sm leading-relaxed ${message.isStreaming ? 'streaming-cursor' : ''}`}>
            {isUser ? (
              <div className="whitespace-pre-wrap">{displayContent}</div>
            ) : (
              <Markdown content={displayContent} />
            )}
          </div>

          {/* Tool Calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.toolCalls.map((toolCall) => (
                <ToolOutput
                  key={toolCall.id}
                  toolName={toolCall.name}
                  args={toolCall.args}
                  result={message.toolResults?.find((r) => r.toolCallId === toolCall.id)?.result}
                  error={message.toolResults?.find((r) => r.toolCallId === toolCall.id)?.error}
                  status={
                    message.toolResults?.find((r) => r.toolCallId === toolCall.id) ? 'success' : 'running'
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

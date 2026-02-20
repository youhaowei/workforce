/**
 * SessionsView - Conversation area for the selected session.
 * Reuses MessageList and MessageInput from the Messages components.
 */

import { MessageSquare } from 'lucide-react';
import { MessageList, MessageInput } from '../Messages';
import type { AgentConfig } from '@/services/types';

interface SessionsViewProps {
  sessionId: string | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    isStreaming: boolean;
    agentConfig?: AgentConfig;
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>;
  }>;
  isStreaming: boolean;
  onSubmit: (submission: { content: string; agentConfig: AgentConfig }) => void;
  onCancel: () => void;
}

export function SessionsView({
  sessionId,
  messages,
  isStreaming,
  onSubmit,
  onCancel,
}: SessionsViewProps) {
  const hasMessages = messages.length > 0 || isStreaming;

  // Messages exist: standard chat layout (message list + input at bottom)
  if (hasMessages) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <MessageList messages={messages} isStreaming={isStreaming} />
        <MessageInput
          onSubmit={onSubmit}
          onCancel={onCancel}
          isStreaming={isStreaming}
          sessionId={sessionId}
          messages={messages}
        />
      </div>
    );
  }

  // Empty state: centered icon/text with input grouped together
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">Start a conversation</p>
          <p className="text-sm text-muted-foreground">
            {sessionId ? 'Send a message to continue' : 'Ask Workforce anything to begin'}
          </p>
        </div>
        <MessageInput
          onSubmit={onSubmit}
          onCancel={onCancel}
          isStreaming={isStreaming}
          sessionId={sessionId}
          messages={messages}
        />
      </div>
    </div>
  );
}

/**
 * SessionsView - Conversation area for the selected session.
 * Reuses MessageList and MessageInput from the Messages components.
 */

import { MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageList, MessageInput } from '../Messages';

interface SessionsViewProps {
  sessionId: string | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    isStreaming: boolean;
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>;
  }>;
  isStreaming: boolean;
  onSubmit: (content: string) => void;
  onCancel: () => void;
  onStartNewChat?: () => void;
}

export function SessionsView({
  sessionId,
  messages,
  isStreaming,
  onSubmit,
  onCancel,
  onStartNewChat,
}: SessionsViewProps) {
  if (!sessionId && messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">No session selected</p>
          <p className="text-sm mb-4">Select a session from the panel or start a new one</p>
          {onStartNewChat && (
            <Button onClick={onStartNewChat}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Chat
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MessageList messages={messages} isStreaming={isStreaming} />
      <MessageInput onSubmit={onSubmit} onCancel={onCancel} isStreaming={isStreaming} />
    </div>
  );
}

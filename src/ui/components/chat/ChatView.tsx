import React, { useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea,
} from '@ui/components/ui';
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  canChat: boolean;
  activeSessionTitle?: string;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  onCreateSession: () => void;
}

export default function ChatView(props: ChatViewProps): React.ReactElement {
  const [chatInput, setChatInput] = useState('');

  const handleSubmit = () => {
    const trimmed = chatInput.trim();
    if (!trimmed || props.isStreaming || !props.canChat) return;

    props.onSubmit(trimmed);
    setChatInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-2 text-xs uppercase tracking-[0.12em] text-zinc-500">
        <span>Session</span>
        <Badge variant="outline">{props.activeSessionTitle ?? 'No active session'}</Badge>
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-6 py-4">
        {!props.canChat ? (
          <Alert>
            <AlertDescription className="space-y-3 text-sm">
              <p>No active session. Create or open a session to start chatting.</p>
              <Button type="button" onClick={props.onCreateSession}>
                Create Session
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {props.canChat && props.messages.length === 0 ? (
          <Alert>
            <AlertDescription className="text-zinc-500">No messages yet.</AlertDescription>
          </Alert>
        ) : null}

        {props.messages.map((message) => (
          <Card key={message.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-zinc-500">
                {message.role}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="whitespace-pre-wrap text-sm text-zinc-800">{message.content}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="border-t border-zinc-200 bg-white p-4">
        <div className="mx-auto max-w-4xl">
          <div className="flex gap-2">
            <Textarea
              value={chatInput}
              placeholder={props.canChat ? 'Type a message...' : 'Create or open a session first'}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              className="min-h-[40px] flex-1"
              disabled={props.isStreaming || !props.canChat}
            />
            {props.isStreaming ? (
              <Button type="button" onClick={props.onCancel} variant="destructive">
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!chatInput.trim() || !props.canChat}
              >
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

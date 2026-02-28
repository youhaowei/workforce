/**
 * SessionsView - Conversation area for the selected session.
 * Reuses MessageList and MessageInput from the Messages components.
 */

import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Project } from '@/services/types';
import { MessageList, MessageInput } from '../Messages';
import type { AgentConfig } from '@/services/types';
import type { ForkInfo } from '../Messages/MessageItem';

const NO_PROJECT_VALUE = '__none__';

interface SessionsViewProps {
  sessionId: string | null;
  projects: Project[];
  newSessionProjectId: string | null;
  onNewSessionProjectChange: (projectId: string | null) => void;
  onCreateProjectForSession: () => void;
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
  forksMap?: Map<string, ForkInfo[]>;
  onSubmit: (submission: { content: string; agentConfig: AgentConfig }) => void;
  onCancel: () => void;
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
  onSelectSession?: (sessionId: string) => void;
}

export function SessionsView({
  sessionId,
  projects,
  newSessionProjectId,
  onNewSessionProjectChange,
  onCreateProjectForSession,
  messages,
  isStreaming,
  forksMap,
  onSubmit,
  onCancel,
  onRewind,
  onFork,
  onSelectSession,
}: SessionsViewProps) {
  const hasMessages = messages.length > 0 || isStreaming;

  // Messages exist: standard chat layout (message list + input at bottom)
  if (hasMessages) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          forksMap={forksMap}
          onRewind={onRewind}
          onFork={onFork}
          onSelectSession={onSelectSession}
        />
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
        {!sessionId && (
          <div className="mb-4 rounded-md border p-3">
            <p className="text-xs text-muted-foreground mb-2">
              Optional: assign this session to a project.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select
                value={newSessionProjectId ?? NO_PROJECT_VALUE}
                onValueChange={(value) => {
                  onNewSessionProjectChange(value === NO_PROJECT_VALUE ? null : value);
                }}
              >
                <SelectTrigger className="sm:flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={onCreateProjectForSession}>
                New Project
              </Button>
            </div>
          </div>
        )}
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

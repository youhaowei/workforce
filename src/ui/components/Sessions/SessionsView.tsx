/**
 * SessionsView - Conversation area for the selected session.
 * Reuses MessageList and MessageInput from the Messages components.
 */

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCcw, Loader2 } from 'lucide-react';
import type { Project } from '@/services/types';
import { MessageList, MessageInput } from '../Messages';
import { useCCSyncBanner } from '@/ui/hooks/useCCSyncBanner';
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
  error: string | null;
  onDismissError: () => void;
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
  error,
  onDismissError,
  onSubmit,
  onCancel,
  onRewind,
  onFork,
  onSelectSession,
}: SessionsViewProps) {
  const { hasUpdate, isSyncing, handleSync } = useCCSyncBanner(sessionId ?? undefined);
  const hasMessages = messages.length > 0 || isStreaming;

  // Messages exist: standard chat layout (message list + input at bottom)
  if (hasMessages) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          forksMap={forksMap}
          error={error}
          onDismissError={onDismissError}
          onRewind={onRewind}
          onFork={onFork}
          onSelectSession={onSelectSession}
        />
        <div className="absolute bottom-0 left-0 z-10 pointer-events-none chat-input-fade" />
        <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
          <div className="pointer-events-auto">
            {hasUpdate && (
              <div role="alert" className="flex items-center gap-2 max-w-3xl mx-auto w-full px-3 py-2 mb-2 rounded-lg bg-amber-500/10 backdrop-blur-xl border border-amber-500/20 text-xs text-amber-700">
                <RefreshCcw className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">This session has new activity from Claude Code</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-500/10"
                  onClick={handleSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>
              </div>
            )}
            <MessageInput
              onSubmit={onSubmit}
              onCancel={onCancel}
              isStreaming={isStreaming}
              disabled={hasUpdate}
              disabledMessage="Sync required — this session has new activity from Claude Code"
              sessionId={sessionId}
              messages={messages}
            />
          </div>
        </div>
      </div>
    );
  }

  // Empty state: centered icon/text with input grouped together
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-6">
          <p className="text-[13px] text-neutral-fg-subtle/50">
            {sessionId ? 'Send a message to continue' : 'What would you like to work on?'}
          </p>
        </div>
        {!sessionId && (
          <div className="mb-4 rounded-md border p-3">
            <p className="text-xs text-neutral-fg-subtle mb-2">
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

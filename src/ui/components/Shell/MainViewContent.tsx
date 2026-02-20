import { SessionsView } from '../Sessions';
import { BoardView } from '../Board';
import { ReviewQueue } from '../Review';
import { AgentDetailView } from '../AgentDetail';
import { TemplateListView } from '../Templates';
import { WorkflowListView } from '../Workflows';
import { AuditView } from '../Audit';
import { OrgListView } from '../Org/OrgListView';
import { HomeView } from '../Home';
import type { ViewType } from './Shell';
import type { AgentConfig } from '@/services/types';

interface MainViewContentProps {
  currentView: ViewType;
  selectedAgentId: string | null;
  selectedSessionId: string | null;
  boardKeyword: string;
  boardStatusFilter: string;
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
  onSelectAgent: (sessionId: string) => void;
  onBackFromDetail: () => void;
  onStartChat: () => void;
  onNavigate: (view: ViewType) => void;
  onSelectSession: (sessionId: string) => void;
  onSubmitMessage: (submission: { content: string; agentConfig: AgentConfig }) => void;
  onCancelStream: () => void;
}

export function MainViewContent({
  currentView,
  selectedAgentId,
  selectedSessionId,
  boardKeyword,
  boardStatusFilter,
  messages,
  isStreaming,
  onSelectAgent,
  onBackFromDetail,
  onStartChat,
  onNavigate,
  onSelectSession,
  onSubmitMessage,
  onCancelStream,
}: MainViewContentProps) {
  switch (currentView) {
    case 'board':
      return (
        <BoardView
          onSelectAgent={onSelectAgent}
          keyword={boardKeyword}
          statusFilter={boardStatusFilter}
        />
      );
    case 'queue':
      return <ReviewQueue />;
    case 'detail':
      return selectedAgentId ? (
        <AgentDetailView
          sessionId={selectedAgentId}
          onBack={onBackFromDetail}
          onNavigateToChild={onSelectAgent}
        />
      ) : null;
    case 'home':
      return (
        <HomeView
          onStartChat={onStartChat}
          onNavigate={onNavigate}
          onSelectSession={onSelectSession}
        />
      );
    case 'sessions':
      return (
        <SessionsView
          sessionId={selectedSessionId}
          messages={messages}
          isStreaming={isStreaming}
          onSubmit={onSubmitMessage}
          onCancel={onCancelStream}
        />
      );
    case 'templates':
      return <TemplateListView />;
    case 'workflows':
      return <WorkflowListView />;
    case 'orgs':
      return <OrgListView />;
    case 'audit':
      return <AuditView />;
    default:
      return null;
  }
}

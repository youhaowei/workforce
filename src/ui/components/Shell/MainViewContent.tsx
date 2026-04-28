import { SessionsView } from "../Sessions";
import { BoardView } from "../Board";
import { ReviewQueue } from "../Review";
import { AgentDetailView } from "../AgentDetail";
import { TemplateListView } from "../Templates";
import { WorkflowListView } from "../Workflows";
import { AuditView } from "../Audit";
import { OrgListView } from "../Org/OrgListView";
import { ProjectView } from "../Project";
import { HomeView } from "../Home";
import type { Project } from "@/services/types";
import type { ViewType } from "./Shell";
import type { AgentConfig } from "@/services/types";
import type { ForkInfo } from "../Messages/MessageItem";
import type { ShellError } from "@/ui/stores/shellStore";

interface MainViewContentProps {
  currentView: ViewType;
  selectedAgentId: string | null;
  selectedSessionId: string | null;
  selectedProjectId: string | null;
  projects: Project[];
  newSessionProjectId: string | null;
  boardKeyword: string;
  boardStatusFilter: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    isStreaming: boolean;
    agentConfig?: AgentConfig;
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>;
  }>;
  isStreaming: boolean;
  forksMap?: Map<string, ForkInfo[]>;
  error: ShellError | null;
  onDismissError: () => void;
  onSelectAgent: (sessionId: string) => void;
  onBackFromDetail: () => void;
  onStartChat: () => void;
  onNavigate: (view: ViewType) => void;
  onOpenSettings: () => void;
  onSelectSession: (sessionId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onNewSessionProjectChange: (projectId: string | null) => void;
  onCreateProjectForSession: () => void;
  onSubmitMessage: (submission: { content: string; agentConfig: AgentConfig }) => void;
  onCancelStream: () => void;
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
}

export function MainViewContent({
  currentView,
  selectedAgentId,
  selectedSessionId,
  selectedProjectId,
  projects,
  newSessionProjectId,
  boardKeyword,
  boardStatusFilter,
  messages,
  isStreaming,
  forksMap,
  error,
  onDismissError,
  onSelectAgent,
  onBackFromDetail,
  onStartChat,
  onNavigate,
  onOpenSettings,
  onSelectSession,
  onSelectProject,
  onNewSessionProjectChange,
  onCreateProjectForSession,
  onSubmitMessage,
  onCancelStream,
  onRewind,
  onFork,
}: MainViewContentProps) {
  switch (currentView) {
    case "board":
      return (
        <BoardView
          onSelectAgent={onSelectAgent}
          keyword={boardKeyword}
          statusFilter={boardStatusFilter}
        />
      );
    case "queue":
      return <ReviewQueue />;
    case "detail":
      return selectedAgentId ? (
        <AgentDetailView
          sessionId={selectedAgentId}
          onBack={onBackFromDetail}
          onNavigateToChild={onSelectAgent}
        />
      ) : null;
    case "home":
      return (
        <HomeView
          onStartChat={onStartChat}
          onNavigate={onNavigate}
          onSelectSession={onSelectSession}
        />
      );
    case "sessions":
      return (
        <SessionsView
          sessionId={selectedSessionId}
          projects={projects}
          newSessionProjectId={newSessionProjectId}
          onNewSessionProjectChange={onNewSessionProjectChange}
          onCreateProjectForSession={onCreateProjectForSession}
          messages={messages}
          isStreaming={isStreaming}
          forksMap={forksMap}
          error={error}
          onDismissError={onDismissError}
          onOpenSettings={onOpenSettings}
          onSubmit={onSubmitMessage}
          onCancel={onCancelStream}
          onRewind={onRewind}
          onFork={onFork}
          onSelectSession={onSelectSession}
        />
      );
    case "projects":
      return (
        <ProjectView
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onStartChat={onStartChat}
          onSelectSession={onSelectSession}
        />
      );
    case "templates":
      return <TemplateListView />;
    case "workflows":
      return <WorkflowListView />;
    case "orgs":
      return <OrgListView />;
    case "audit":
      return <AuditView />;
    default:
      return null;
  }
}

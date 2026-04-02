import { createContext, useContext, type ReactNode } from "react";
import type { Project, AgentConfig } from "@/services/types";
import type { ForkInfo } from "../components/Messages/MessageItem";

export interface ShellContextValue {
  // Session state
  selectedSessionId: string | null;
  selectedProjectId: string | null;
  selectedAgentId: string | null;
  newSessionProjectId: string | null;

  // Messages
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

  // Projects
  projects: Project[];

  // Board filters
  boardKeyword: string;
  boardStatusFilter: string;

  // Error state
  error: string | null;

  // Actions
  onSelectSession: (sessionId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onSelectAgent: (sessionId: string) => void;
  onBackFromDetail: () => void;
  onStartChat: () => void;
  onNewSessionProjectChange: (projectId: string | null) => void;
  onCreateProjectForSession: () => void;
  onSubmitMessage: (submission: { content: string; agentConfig: AgentConfig }) => void;
  onCancelStream: () => void;
  onDismissError: () => void;
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ShellContextValue;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error("useShell must be used within ShellProvider");
  }
  return context;
}

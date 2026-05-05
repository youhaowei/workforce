export interface CCBase {
  type: string;
  parentUuid?: string | null;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  cwd?: string;
  slug?: string;
  isMeta?: boolean;
}

export interface CCUser extends CCBase {
  type: "user";
  message: {
    role: "user";
    content: string | CCContentBlock[];
  };
  toolUseResult?: {
    type: string;
    file?: { filePath: string; content: string };
  };
}

export interface CCAssistant extends CCBase {
  type: "assistant";
  message: {
    id: string;
    model?: string;
    role: "assistant";
    content: CCContentBlock[];
    stop_reason: string | null;
    usage?: CCUsage;
  };
}

export interface CCContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | CCContentBlock[];
}

export interface CCUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface CCProgress extends CCBase {
  type: "progress";
  data?: {
    type?: string;
    hookEvent?: string;
    hookName?: string;
    toolUseID?: string;
    content?: string;
    output?: string;
    durationMs?: number;
    [key: string]: unknown;
  };
}

export interface CCSystem extends CCBase {
  type: "system";
  subtype?: string;
  durationMs?: number;
  hookCount?: number;
  hookInfos?: Array<{ command: string; durationMs: number }>;
  content?: string;
  compactMetadata?: { trigger?: string; preTokens?: number };
  [key: string]: unknown;
}

export interface CCFileHistorySnapshot extends CCBase {
  type: "file-history-snapshot";
  messageId?: string;
  snapshot?: {
    messageId?: string;
    trackedFileBackups?: Record<string, unknown>;
    timestamp?: string;
  };
}

export interface CCQueueOperation extends CCBase {
  type: "queue-operation";
  operation: string;
  content?: string;
}

export interface CCPrLink extends CCBase {
  type: "pr-link";
  prNumber?: number;
  prUrl?: string;
  prRepository?: string;
}

export type CCRecord =
  | CCUser
  | CCAssistant
  | CCProgress
  | CCSystem
  | CCFileHistorySnapshot
  | CCQueueOperation
  | CCPrLink
  | CCBase;

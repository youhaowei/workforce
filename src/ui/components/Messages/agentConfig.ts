import type {
  AgentConfig,
  AgentDefaults,
  AgentModelInfo,
  AgentPermissionMode,
  AgentTone,
  ThinkingLevel,
  VerboseLevel,
} from "@/services/types";

export const AGENT_CONFIG_LAST_KEY = "agent-config-last";
export const AGENT_MODELS_CACHE_KEY = "agent-models-cache";

export const SEED_MODELS: AgentModelInfo[] = [
  { id: "claude-opus-4-6", displayName: "Opus 4.6", description: "Most capable model" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", description: "Fast and capable" },
  {
    id: "claude-sonnet-4-5-20250929",
    displayName: "Sonnet 4.5",
    description: "Balanced performance",
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Haiku 4.5",
    description: "Fastest, lowest cost",
  },
];

export const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Maps UI thinkingLevel to SDK maxThinkingTokens. undefined = omit (SDK decides). */
export const THINKING_TOKENS: Record<ThinkingLevel, number | undefined> = {
  off: 0,
  auto: undefined,
  low: 2048,
  medium: 8192,
  high: 16384,
};

export const PERMISSION_OPTIONS: Array<{ value: AgentPermissionMode; label: string }> = [
  { value: "plan", label: "Plan" },
  { value: "default", label: "Ask" },
  { value: "acceptEdits", label: "Auto-Edit" },
  { value: "bypassPermissions", label: "Bypass" },
];

export const TONE_OPTIONS: Array<{ value: AgentTone; label: string }> = [
  { value: "friendly", label: "Friendly" },
  { value: "professional", label: "Professional" },
  { value: "direct", label: "Direct" },
  { value: "technical", label: "Technical" },
];

export const VERBOSE_OPTIONS: Array<{ value: VerboseLevel; label: string }> = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Thorough" },
  { value: "exhaustive", label: "Exhaustive" },
];

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  model: "claude-opus-4-6",
  thinkingLevel: "auto",
  tone: "friendly",
  verboseLevel: "balanced",
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: SEED_MODELS[2].id, // Sonnet 4.5
  thinkingLevel: "auto",
  permissionMode: "default",
};

function isAgentModelInfo(value: unknown): value is AgentModelInfo {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as AgentModelInfo).id === "string" &&
    "displayName" in value &&
    typeof (value as AgentModelInfo).displayName === "string" &&
    "description" in value &&
    typeof (value as AgentModelInfo).description === "string",
  );
}

export function getModelsFromCache(): AgentModelInfo[] {
  try {
    const raw = localStorage.getItem(AGENT_MODELS_CACHE_KEY);
    if (!raw) return SEED_MODELS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return SEED_MODELS;
    const valid = parsed.filter(isAgentModelInfo);
    return valid.length > 0 ? valid : SEED_MODELS;
  } catch {
    return SEED_MODELS;
  }
}

export function cacheModels(models: AgentModelInfo[]): void {
  if (models.length === 0) return;
  localStorage.setItem(AGENT_MODELS_CACHE_KEY, JSON.stringify(models));
}

export function parseStoredAgentConfig(raw: string | null): AgentConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (
      typeof parsed.model === "string" &&
      parsed.model.length > 0 &&
      THINKING_LEVELS.some((option) => option.value === parsed.thinkingLevel) &&
      PERMISSION_OPTIONS.some((option) => option.value === parsed.permissionMode)
    ) {
      return parsed as AgentConfig;
    }
    return null;
  } catch {
    return null;
  }
}

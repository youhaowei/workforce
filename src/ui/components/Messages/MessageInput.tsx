/**
 * MessageInput - Chat input with auto-resizing textarea and per-message agent config toolbar.
 *
 * Config priority on session change:
 *   last user message's agentConfig → localStorage('agent-config-last') → DEFAULT_AGENT_CONFIG
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Send, Square } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import type { AgentConfig, AgentPermissionMode, ThinkingLevel } from '@/services/types';
import AgentConfigToolbar from './AgentConfigToolbar';
import {
  AGENT_CONFIG_LAST_KEY,
  DEFAULT_AGENT_CONFIG,
  cacheModels,
  getModelsFromCache,
  parseStoredAgentConfig,
} from './agentConfig';

interface MessageInputProps {
  onSubmit: (submission: { content: string; agentConfig: AgentConfig }) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  placeholder?: string;
  sessionId?: string | null;
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    agentConfig?: AgentConfig;
  }>;
}

function getInitialConfig(
  messages?: MessageInputProps['messages'],
  sessionId?: string | null,
  orgDefaults?: { model: string; thinkingLevel: ThinkingLevel } | null,
): AgentConfig {
  // Priority 1: last user message's agentConfig in the current session
  if (sessionId && messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].agentConfig) {
        return messages[i].agentConfig!;
      }
    }
  }
  // Priority 2: localStorage last-used config
  const stored = parseStoredAgentConfig(localStorage.getItem(AGENT_CONFIG_LAST_KEY));
  if (stored) return stored;
  // Priority 3: org-level defaults
  if (orgDefaults) {
    return {
      model: orgDefaults.model,
      thinkingLevel: orgDefaults.thinkingLevel,
      permissionMode: DEFAULT_AGENT_CONFIG.permissionMode,
    };
  }
  // Priority 4: hardcoded defaults
  return DEFAULT_AGENT_CONFIG;
}

export default function MessageInput({
  onSubmit,
  onCancel,
  isStreaming,
  placeholder,
  sessionId,
  messages,
}: MessageInputProps) {
  const trpc = useTRPC();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch org-level defaults for initial config cascade
  const { data: currentOrg } = useQuery(
    trpc.org.getCurrent.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const orgDefaults = currentOrg?.settings?.agentDefaults ?? null;

  const [models, setModels] = useState(() => getModelsFromCache());
  const [initialConfig] = useState(() => getInitialConfig(messages, sessionId));
  const [model, setModel] = useState(initialConfig.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(initialConfig.thinkingLevel);
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(initialConfig.permissionMode);

  // Apply org defaults once they resolve, but only if no higher-priority config was set.
  // orgDefaults intentionally NOT in the restore effect deps — this one-shot effect handles
  // the async resolution that the useState initializer missed.
  const orgDefaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (!orgDefaults || orgDefaultsAppliedRef.current) return;
    orgDefaultsAppliedRef.current = true;
    // Only apply if current config matches hardcoded defaults (no session/localStorage override)
    if (model === DEFAULT_AGENT_CONFIG.model && thinkingLevel === DEFAULT_AGENT_CONFIG.thinkingLevel) {
      const validModel = models.length > 0 && !models.some((m) => m.id === orgDefaults.model)
        ? models[0].id
        : orgDefaults.model;
      setModel(validModel);
      setThinkingLevel(orgDefaults.thinkingLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgDefaults]);

  // Fetch supported models via React Query (5-minute stale window)
  const { data: supportedModels } = useQuery(
    trpc.agent.supportedModels.queryOptions(undefined, {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    }),
  );

  // Update model list when fresh data arrives
  useEffect(() => {
    if (!supportedModels || supportedModels.length === 0) return;
    setModels(supportedModels);
    cacheModels(supportedModels);
  }, [supportedModels]);

  // Auto-correct model selection if current model is no longer available.
  // model intentionally omitted from deps — only re-check when the list changes, not on every selection.
  // Session restore handles its own validation inline (see below).
  useEffect(() => {
    if (models.length === 0) return;
    if (!models.some((m) => m.id === model)) {
      setModel(models[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // Restore config when session changes, and re-apply once messages load asynchronously.
  // Two-phase approach handles the race: Shell clears messages before the async fetch,
  // so we apply localStorage fallback immediately, then re-apply from session history
  // once messages arrive.
  // Model is validated against current list to handle stale/deprecated model IDs.
  const sessionConfigRef = useRef<{ sessionId: string | null | undefined; appliedWithMessages: boolean }>({
    sessionId: undefined,
    appliedWithMessages: false,
  });
  useEffect(() => {
    const prev = sessionConfigRef.current;
    const sessionChanged = sessionId !== prev.sessionId;
    const hasMessages = messages !== undefined && messages.length > 0;
    if (sessionChanged) {
      sessionConfigRef.current = { sessionId: sessionId ?? null, appliedWithMessages: hasMessages };
      const cfg = getInitialConfig(messages, sessionId);
      const validModel = models.length > 0 && !models.some((m) => m.id === cfg.model)
        ? models[0].id
        : cfg.model;
      setModel(validModel);
      setThinkingLevel(cfg.thinkingLevel);
      setPermissionMode(cfg.permissionMode);
    } else if (!prev.appliedWithMessages && hasMessages) {
      // Same session: messages just loaded — re-apply to pick up session-specific agentConfig
      sessionConfigRef.current = { ...prev, appliedWithMessages: true };
      const cfg = getInitialConfig(messages, sessionId);
      const validModel = models.length > 0 && !models.some((m) => m.id === cfg.model)
        ? models[0].id
        : cfg.model;
      setModel(validModel);
      setThinkingLevel(cfg.thinkingLevel);
      setPermissionMode(cfg.permissionMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, messages, models]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !isStreaming) {
      const agentConfig: AgentConfig = { model, thinkingLevel, permissionMode };
      try {
        localStorage.setItem(AGENT_CONFIG_LAST_KEY, JSON.stringify(agentConfig));
      } catch {
        // ignore
      }
      onSubmit({ content: trimmed, agentConfig });
      setValue('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [value, isStreaming, model, thinkingLevel, permissionMode, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        if (isStreaming && onCancel) {
          onCancel();
        } else {
          setValue('');
        }
      }
    },
    [handleSubmit, isStreaming, onCancel],
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="flex-shrink-0 px-6 py-3 border-t bg-background/80 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-stretch gap-3 rounded-xl border bg-card px-4 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? 'Ask Workforce anything...'}
            disabled={isStreaming}
            rows={1}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground resize-none outline-none text-sm min-h-[36px] max-h-[200px] disabled:opacity-50 py-2"
          />

          <div className="flex items-end">
            {isStreaming ? (
              <Button variant="outline" size="sm" onClick={handleCancel}>
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!value.trim()}
                className="h-9 w-9"
                title="Send (Enter)"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <AgentConfigToolbar
            model={model}
            thinkingLevel={thinkingLevel}
            permissionMode={permissionMode}
            models={models}
            onModelChange={setModel}
            onThinkingChange={setThinkingLevel}
            onPermissionChange={setPermissionMode}
            disabled={isStreaming}
          />
          {isStreaming && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Workforce is thinking...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

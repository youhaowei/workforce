/**
 * MessageInput - Chat input with auto-resizing textarea and per-message agent config toolbar.
 *
 * Config priority on session change:
 *   last user message's agentConfig → localStorage('agent-config-last') → DEFAULT_AGENT_CONFIG
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Square } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import type { AgentConfig, AgentPermissionMode, ThinkingLevel } from '@/services/types';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import { useSdkStore } from '@/ui/stores/useSdkStore';
import { Card } from '@/components/ui/card';
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
  disabled?: boolean;
  disabledMessage?: string;
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
  disabled,
  disabledMessage,
  placeholder,
  sessionId,
  messages,
}: MessageInputProps) {
  const trpc = useTRPC();
  const currentTool = useMessagesStore((s) => s.currentTool);
  const messageCount = useMessagesStore((s) => s.messages.length);
  const cumulativeUsage = useSdkStore((s) => s.cumulativeUsage);
  const currentQueryStats = useSdkStore((s) => s.currentQueryStats);
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

  // Fetch supported models via React Query — polls to pick up background SDK refresh
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

  // Consume draft input set by rewind/fork — populate textarea once, then clear.
  const draftInput = useMessagesStore((s) => s.draftInput);
  const setDraftInput = useMessagesStore((s) => s.setDraftInput);
  useEffect(() => {
    if (draftInput !== null) {
      setValue(draftInput);
      setDraftInput(null);
      // Defer focus so the textarea has the new value when focused
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [draftInput, setDraftInput]);

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

  const hasStats = cumulativeUsage.inputTokens > 0 || messageCount > 0;

  return (
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div className="max-w-3xl mx-auto">
        <Card className="bg-neutral-bg/80 backdrop-blur-xl saturate-[1.2] rounded-(--surface-radius) shadow-[var(--shadow-lg),0_0_12px_var(--neutral-ring-glow)] border-0 transition-shadow focus-within:shadow-[var(--shadow-lg),0_0_0_1px_var(--neutral-ring),0_0_20px_var(--neutral-ring-glow)]">
          {/* Textarea area */}
          <div className="px-6 pt-[18px] pb-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder={disabled && disabledMessage ? disabledMessage : placeholder ?? 'Ask Workforce anything...'}
              disabled={isStreaming || disabled}
              rows={3}
              className="w-full bg-transparent text-neutral-fg placeholder:text-neutral-fg-subtle/30 resize-none outline-none text-[15px] min-h-[72px] max-h-[200px] disabled:opacity-50"
            />
          </div>

          {/* Toolbar row — inside the card */}
          <div className="flex items-center justify-between px-5 pb-3">
            <div className="flex items-center gap-1.5">
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
                <span className="text-[11px] text-neutral-fg-subtle/40 flex items-center gap-1.5 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-fg/25 animate-pulse" />
                  {currentTool ? `Using ${currentTool}` : 'Thinking...'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {hasStats && (
                <span className="text-[11px] text-neutral-fg-subtle/35 tabular-nums flex items-center gap-2">
                  {cumulativeUsage.totalCostUsd > 0 && (
                    <span>${cumulativeUsage.totalCostUsd.toFixed(4)}</span>
                  )}
                  {currentQueryStats && (
                    <span>{(currentQueryStats.durationMs / 1000).toFixed(1)}s</span>
                  )}
                  <span>{messageCount} msg</span>
                </span>
              )}
              {isStreaming ? (
                <button
                  onClick={handleCancel}
                  className="h-8 px-3 rounded-lg text-xs font-medium text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-dim/50 transition-colors flex items-center gap-1.5"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!value.trim()}
                  className="h-[34px] w-[34px] rounded-xl bg-neutral-fg text-neutral-bg flex items-center justify-center disabled:opacity-15 transition-all hover:scale-105 active:scale-95"
                  title="Send (Enter)"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

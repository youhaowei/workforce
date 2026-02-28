/**
 * usePlanMode — Manages plan panel state, approve/reject flow, and plan artifact lifecycle.
 *
 * Extracted from Shell to keep it under the max-lines lint threshold.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { trpc as trpcClient } from '@/bridge/trpc';
import type { AgentConfig, AgentPermissionMode, PlanArtifact } from '@/services/types';
import type { MessageState } from '@/ui/stores/useMessagesStore';

function resolveLastModel(messages: MessageState[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].agentConfig?.model !== undefined) {
      return messages[i].agentConfig!.model;
    }
  }
  return 'sonnet';
}

function resolveLastThinking(messages: MessageState[]): AgentConfig['thinkingLevel'] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].agentConfig?.thinkingLevel !== undefined) {
      return messages[i].agentConfig!.thinkingLevel;
    }
  }
  return 'auto';
}

interface UsePlanModeParams {
  selectedSessionId: string | null;
  messages: MessageState[];
  onCancelStream: () => void;
  onSubmit: (submission: { content: string; agentConfig: AgentConfig }) => void;
}

function resolveLastPermission(messages: MessageState[]): AgentPermissionMode | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].agentConfig?.permissionMode !== undefined) {
      return messages[i].agentConfig!.permissionMode;
    }
  }
  return undefined;
}

export function usePlanMode({ selectedSessionId, messages, onCancelStream, onSubmit }: UsePlanModeParams) {
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [planArtifact, setPlanArtifact] = useState<PlanArtifact | null>(null);
  const [planContent, setPlanContent] = useState('');
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);
  const sessionIdRef = useRef(selectedSessionId);

  // Derive plan mode from the last user message's permission setting
  const isPlanMode = resolveLastPermission(messages) === 'plan';

  // Auto-open panel when entering plan mode (even before plan arrives)
  const prevPlanMode = useRef(false);
  useEffect(() => {
    if (isPlanMode && !prevPlanMode.current) {
      setPlanPanelOpen(true);
    }
    prevPlanMode.current = isPlanMode;
  }, [isPlanMode]);

  // Clear plan state when switching sessions
  useEffect(() => {
    sessionIdRef.current = selectedSessionId;
    setPlanPanelOpen(false);
    setPlanArtifact(null);
    setPlanContent('');
    setPlanLoadError(null);
    prevPlanMode.current = false;
  }, [selectedSessionId]);

  /** Called by the onData handler when a `plan_ready` event arrives. */
  const handlePlanReady = useCallback((path: string, sessId: string | null) => {
    setPlanLoadError(null);
    trpcClient.session.readFile.query({ path }).then((fileContent) => {
      // Guard against stale resolution after session switch
      if (sessionIdRef.current !== sessId) return;
      const titleMatch = fileContent.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : path.split('/').pop() ?? 'Plan';
      const artifact: PlanArtifact = {
        path, title, status: 'pending_review', updatedAt: Date.now(),
      };
      setPlanArtifact(artifact);
      setPlanContent(fileContent);
      setPlanPanelOpen(true);
      if (sessId) {
        trpcClient.session.updatePlanArtifact.mutate({
          sessionId: sessId, artifact,
        }).catch(() => {/* best-effort */});
      }
    }).catch((err) => {
      setPlanLoadError(err instanceof Error ? err.message : 'Failed to load plan file');
      setPlanPanelOpen(true);
    });
  }, []);

  const handlePlanApprove = useCallback((permission: AgentPermissionMode) => {
    if (!planArtifact) return;
    setPlanArtifact((prev) => prev ? { ...prev, status: 'approved', approvedPermission: permission } : null);
    setPlanPanelOpen(false);
    if (selectedSessionId) {
      trpcClient.session.updatePlanArtifact.mutate({
        sessionId: selectedSessionId,
        artifact: { ...planArtifact, status: 'approved', approvedPermission: permission, updatedAt: Date.now() },
      }).catch(() => {/* best-effort */});
    }
    // Cancel any in-flight stream. The 100ms delay gives the server-side agent time
    // to process the abort signal and reset queryInProgress before the new query arrives.
    onCancelStream();
    const lastModel = resolveLastModel(messages);
    const lastThinking = resolveLastThinking(messages);
    setTimeout(() => {
      onSubmit({
        content: `Execute the plan at ${planArtifact.path}`,
        agentConfig: { model: lastModel, thinkingLevel: lastThinking, permissionMode: permission },
      });
    }, 100);
  }, [planArtifact, selectedSessionId, messages, onCancelStream, onSubmit]);

  const handlePlanReject = useCallback(() => {
    if (!planArtifact) return;
    setPlanArtifact((prev) => prev ? { ...prev, status: 'rejected' } : null);
    setPlanPanelOpen(false);
    if (selectedSessionId) {
      trpcClient.session.updatePlanArtifact.mutate({
        sessionId: selectedSessionId,
        artifact: { ...planArtifact, status: 'rejected', updatedAt: Date.now() },
      }).catch(() => {/* best-effort */});
    }
  }, [planArtifact, selectedSessionId]);

  const handlePlanClose = useCallback(() => {
    setPlanPanelOpen(false);
  }, []);

  const handleOpenPlan = useCallback(() => {
    if (planArtifact) setPlanPanelOpen(true);
  }, [planArtifact]);

  return {
    isPlanMode,
    planPanelOpen,
    planArtifact,
    planContent,
    planLoadError,
    handlePlanReady,
    handlePlanApprove,
    handlePlanReject,
    handlePlanClose,
    handleOpenPlan,
  };
}

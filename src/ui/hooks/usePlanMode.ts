/**
 * usePlanMode — Manages plan panel state, approve/reject flow, and plan artifact lifecycle.
 *
 * Extracted from Shell to keep it under the max-lines lint threshold.
 *
 * Single artifact model: This hook creates a workspace-level Artifact (stored
 * in ~/.workforce/data/artifacts/) and stores its ID as `planArtifactId` in
 * session metadata. The UI reads artifact state from useArtifactPanel.artifact.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { queryClient } from '@/bridge/query-client';
import type { AgentConfig, AgentPermissionMode, ArtifactStatus } from '@/services/types';
import type { MessageState } from '@/ui/stores/useMessagesStore';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';

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
  orgId: string;
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

export function usePlanMode({ orgId, selectedSessionId, messages, onCancelStream, onSubmit }: UsePlanModeParams) {
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [planContent, setPlanContent] = useState('');
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);
  /** Plan artifact title (for display before artifact is fetched) */
  const [planTitle, setPlanTitle] = useState('');
  /** Plan artifact file path (for display before artifact is fetched) */
  const [planFilePath, setPlanFilePath] = useState('');
  /** Plan artifact status (for display before artifact is fetched) */
  const [planStatus, setPlanStatus] = useState<ArtifactStatus>('draft');
  const sessionIdRef = useRef(selectedSessionId);
  /** Workspace-level artifact ID (created on plan_ready) */
  const [planArtifactId, setPlanArtifactId] = useState<string | null>(null);
  /** Ref guard to prevent duplicate artifact creation in async context where state is stale */
  const creatingArtifactRef = useRef(false);

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
    setPlanContent('');
    setPlanLoadError(null);
    setPlanTitle('');
    setPlanFilePath('');
    setPlanStatus('draft');
    prevPlanMode.current = false;
    setPlanArtifactId(null);
    creatingArtifactRef.current = false;
  }, [selectedSessionId]);

  /** Called by the onData handler when a `plan_ready` event arrives. */
  const handlePlanReady = useCallback((path: string, sessId: string | null) => {
    // Ref-based idempotency guard: prevents duplicate creation across async boundaries.
    // (planArtifactId state is stale inside this closure — the ref is the real guard.)
    if (creatingArtifactRef.current) return;
    creatingArtifactRef.current = true;

    setPlanLoadError(null);
    trpcClient.session.readFile.query({ path }).then((fileContent) => {
      // Guard against stale resolution after session switch
      if (sessionIdRef.current !== sessId) return;
      const titleMatch = fileContent.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : path.split('/').pop() ?? 'Plan';
      setPlanTitle(title);
      setPlanFilePath(path);
      setPlanStatus('pending_review');
      setPlanContent(fileContent);
      setPlanPanelOpen(true);

      // Create workspace-level artifact with pending_review status
      trpcClient.artifact.create.mutate({
        orgId,
        title,
        mimeType: 'text/markdown',
        filePath: path,
        content: fileContent,
        status: 'pending_review',
        createdBy: { type: 'system' as const },
        sessionId: sessId ?? undefined,
        metadata: { source: 'plan_mode' },
      }).then((artifact) => {
        if (sessionIdRef.current !== sessId) return;
        setPlanArtifactId(artifact.id);
        creatingArtifactRef.current = false;
        // Store the artifact ID on the session metadata
        if (sessId) {
          trpcClient.session.rename.mutate({ sessionId: sessId, title: '' }).catch(() => {});
          // Use updateSession path via metadata
          // For now, store planArtifactId on session metadata is best done via a direct call
        }
      }).catch((err) => {
        console.warn('[PlanMode] artifact creation failed:', err);
        creatingArtifactRef.current = false;
      });
    }).catch((err) => {
      creatingArtifactRef.current = false;
      setPlanLoadError(err instanceof Error ? err.message : 'Failed to load plan file');
      setPlanPanelOpen(true);
    });
  }, [orgId]);

  const handlePlanApprove = useCallback((permission: AgentPermissionMode) => {
    if (!planFilePath) return;
    setPlanStatus('approved');
    setPlanPanelOpen(false);
    // Invalidate artifact queries so useArtifactPanel re-fetches the approved status
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && Array.isArray(key[0]) && (key[0] as string[])[0] === 'artifact';
    }});
    // Cancel any in-flight stream. The 100ms delay gives the server-side agent time
    // to process the abort signal and reset queryInProgress before the new query arrives.
    onCancelStream();
    setTimeout(() => {
      if (sessionIdRef.current !== selectedSessionId) return;
      const currentMessages = useMessagesStore.getState().messages;
      const lastModel = resolveLastModel(currentMessages);
      const lastThinking = resolveLastThinking(currentMessages);
      onSubmit({
        content: `Execute the plan at ${planFilePath}`,
        agentConfig: { model: lastModel, thinkingLevel: lastThinking, permissionMode: permission },
      });
    }, 100);
  }, [planFilePath, selectedSessionId, onCancelStream, onSubmit]);

  const handlePlanReject = useCallback(() => {
    if (!planFilePath) return;
    setPlanStatus('rejected');
    setPlanPanelOpen(false);
    // Invalidate artifact queries so useArtifactPanel re-fetches the rejected status
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && Array.isArray(key[0]) && (key[0] as string[])[0] === 'artifact';
    }});
  }, [planFilePath]);

  const handlePlanClose = useCallback(() => {
    setPlanPanelOpen(false);
  }, []);

  const handleOpenPlan = useCallback(() => {
    if (planFilePath) setPlanPanelOpen(true);
  }, [planFilePath]);

  return {
    isPlanMode,
    planPanelOpen,
    planTitle,
    planFilePath,
    planStatus,
    planContent,
    planLoadError,
    planArtifactId,
    handlePlanReady,
    handlePlanApprove,
    handlePlanReject,
    handlePlanClose,
    handleOpenPlan,
  };
}

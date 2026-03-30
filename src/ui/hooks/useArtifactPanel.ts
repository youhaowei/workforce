/**
 * useArtifactPanel - Manages artifact panel state: pending comments, review, artifact list.
 *
 * Wraps tRPC calls for addComment, submitReview, and artifact listing.
 * Generates structured prompt text from accumulated comments + general feedback.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc as trpcClient } from '@/bridge/trpc';
import { useTRPC } from '@/bridge/react';
import type { ArtifactComment } from '@/services/types';
import { generateReviewPrompt } from '@/ui/lib/artifact-utils';

type CommentSeverity = ArtifactComment['severity'];

interface UseArtifactPanelParams {
  planArtifactId: string | null;
  sessionId: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  onSubmitPrompt?: (prompt: string) => void;
}

export function useArtifactPanel({
  planArtifactId,
  sessionId,
  onApprove,
  onReject,
  onSubmitPrompt,
}: UseArtifactPanelParams) {
  const trpc = useTRPC();
  const [pendingComments, setPendingComments] = useState<ArtifactComment[]>([]);
  const pendingCommentsRef = useRef<ArtifactComment[]>([]);
  useEffect(() => {
    pendingCommentsRef.current = pendingComments;
  }, [pendingComments]);
  /** Artifact opened from the info panel (overrides planArtifactId) */
  const [browsedArtifactId, setBrowsedArtifactId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const activeArtifactId = browsedArtifactId ?? planArtifactId;

  useEffect(() => {
    setPendingComments([]);
  }, [activeArtifactId]);

  // Fetch active artifact via React Query (no useEffect)
  const { data: artifact = null } = useQuery({
    ...trpc.artifact.get.queryOptions({ artifactId: activeArtifactId! }),
    enabled: !!activeArtifactId,
    staleTime: 10_000,
  });

  // Fetch session artifacts via React Query
  const { data: sessionArtifacts = [] } = useQuery({
    ...trpc.artifact.list.queryOptions({ sessionId: sessionId! }),
    enabled: !!sessionId,
    staleTime: 30_000,
  });

  const addComment = useCallback(
    (line: number, text: string, severity: CommentSeverity) => {
      if (!activeArtifactId) return;
      // Optimistic local add
      const optimistic: ArtifactComment = {
        id: `local_${Date.now()}`,
        artifactId: activeArtifactId,
        content: text,
        severity,
        anchor: { line },
        author: { type: 'user', id: 'local' },
        createdAt: Date.now(),
      };
      setPendingComments((prev) => [...prev, optimistic]);

      // Persist to server
      trpcClient.artifact.addComment.mutate({
        artifactId: activeArtifactId,
        content: text,
        severity,
        anchor: { line },
        author: { type: 'user', id: 'local' },
      }).then((serverComment) => {
        // Replace optimistic with server version
        setPendingComments((prev) =>
          prev.map((c) => (c.id === optimistic.id ? serverComment : c)),
        );
      }).catch((err) => {
        console.warn('[ArtifactPanel] addComment failed:', err);
        setPendingComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      });
    },
    [activeArtifactId],
  );

  const submitReview = useCallback(
    (summary: string) => {
      if (!activeArtifactId) return;
      const id = activeArtifactId;
      const title = artifact?.title ?? 'artifact';
      const comments = pendingCommentsRef.current;
      const prompt = generateReviewPrompt(title, comments, summary);

      trpcClient.artifact.submitReview.mutate({
        artifactId: id,
        action: 'edit',
        comments: comments.map((c) => ({
          artifactId: id, content: c.content, severity: c.severity, anchor: c.anchor, author: c.author,
        })),
        summary,
        author: { type: 'user', id: 'local' },
      }).catch((err) => console.warn('[ArtifactPanel] mutation failed:', err));

      setPendingComments([]);
      onSubmitPrompt?.(prompt);
    },
    [activeArtifactId, artifact, onSubmitPrompt],
  );

  const handleApprove = useCallback(
    () => {
      const id = activeArtifactId;
      const comments = pendingCommentsRef.current;
      if (id) {
        trpcClient.artifact.submitReview.mutate({
          artifactId: id,
          action: 'approve',
          comments: comments.map((c) => ({
            artifactId: id, content: c.content, severity: c.severity, anchor: c.anchor, author: c.author,
          })),
          author: { type: 'user', id: 'local' },
        }).catch((err) => console.warn('[ArtifactPanel] mutation failed:', err));
      }
      setPendingComments([]);
      onApprove?.();
    },
    [activeArtifactId, onApprove],
  );

  const handleReject = useCallback(() => {
    const id = activeArtifactId;
    const comments = pendingCommentsRef.current;
    if (id) {
      trpcClient.artifact.submitReview.mutate({
        artifactId: id,
        action: 'reject',
        comments: comments.map((c) => ({
          artifactId: id, content: c.content, severity: c.severity, anchor: c.anchor, author: c.author,
        })),
        author: { type: 'user', id: 'local' },
      }).catch((err) => console.warn('[ArtifactPanel] mutation failed:', err));
    }
    setPendingComments([]);
    onReject?.();
  }, [activeArtifactId, onReject]);

  const openArtifact = useCallback((artifactId: string) => {
    setBrowsedArtifactId(artifactId);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setBrowsedArtifactId(null);
  }, []);

  return {
    artifact,
    activeArtifactId,
    panelOpen,
    pendingComments,
    sessionArtifacts,
    addComment,
    submitReview,
    handleApprove,
    handleReject,
    openArtifact,
    closePanel,
  };
}

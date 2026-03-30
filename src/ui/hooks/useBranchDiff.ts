/**
 * useBranchDiff - Manages branch diff panel state.
 *
 * Fetches the current branch diff (vs default base) via the git tRPC router.
 * Provides open/close/focus-file controls for the BranchDiffPanel.
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';

export function useBranchDiff() {
  const trpc = useTRPC();
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusFile, setFocusFile] = useState<string | null>(null);

  const { data: gitStatus } = useQuery({
    ...trpc.git.status.queryOptions(),
    staleTime: 10_000,
  });

  const { data: branchDiff, isLoading } = useQuery({
    ...trpc.git.branchDiff.queryOptions(),
    enabled: panelOpen,
    staleTime: 30_000,
  });

  const openDiffPanel = useCallback((file?: string) => {
    setFocusFile(file ?? null);
    setPanelOpen(true);
  }, []);

  const closeDiffPanel = useCallback(() => {
    setPanelOpen(false);
    setFocusFile(null);
  }, []);

  const selectFile = useCallback((file: string) => {
    setFocusFile(file);
    if (!panelOpen) setPanelOpen(true);
  }, [panelOpen]);

  return {
    panelOpen,
    isLoading,
    branch: gitStatus?.branch ?? 'HEAD',
    baseBranch: 'main',
    patch: branchDiff?.patch ?? '',
    files: branchDiff?.files ?? [],
    focusFile,
    openDiffPanel,
    closeDiffPanel,
    selectFile,
  };
}

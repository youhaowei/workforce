/**
 * GitBranchBadge - Shows current git branch name and dirty/clean indicator.
 * Displayed in the floating session pill at the top of the stage area.
 */

import { GitBranch } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';

export function GitBranchBadge() {
  const trpc = useTRPC();
  const { data: status } = useQuery({
    ...trpc.git.status.queryOptions(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (!status) return null;

  return (
    <div className="flex items-center gap-1 text-[10px] text-neutral-fg/50 select-none">
      <GitBranch className="h-2.5 w-2.5" />
      <span className="truncate max-w-24">{status.branch}</span>
      {!status.isClean && (
        <span className="h-1.5 w-1.5 rounded-full bg-palette-warning shrink-0" title="Uncommitted changes" />
      )}
    </div>
  );
}

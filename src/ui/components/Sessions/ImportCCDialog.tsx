/**
 * ImportCCDialog - Command palette for importing external Claude Code sessions.
 *
 * Lazy discovery: fetches CC sessions only when the dialog opens.
 * Single-select: picking a session imports it immediately and closes.
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/services/types';
import { Loader2, Folder, GitBranch, GitFork } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ClaudeIcon } from '@/ui/components/icons/ClaudeIcon';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { useTRPC } from '@/bridge/react';
import { timeAgo } from '@/ui/lib/time';
import { CLAUDE_COLOR, WORKTREE_COLOR } from '@/ui/lib/brand-colors';

function folderInfo(cwd?: string): { folder?: string; worktree?: string } {
  if (!cwd) return {};
  // Worktree paths like ~/.agents/worktrees/<repo>/<name> → resolve to project
  const wtMatch = cwd.match(/\.agents\/worktrees\/([^/]+)\/([^/]+)/);
  if (wtMatch) return { folder: `Projects/${wtMatch[1]}`, worktree: wtMatch[2] };
  const parts = cwd.split('/').filter(Boolean);
  const folder = parts.length >= 2
    ? parts.slice(-2).join('/')
    : parts[parts.length - 1];
  return { folder };
}

export interface ImportCCDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onImported?: (sessionId: string) => void;
}

type ProjectIndex = { byPath: Map<string, Project>; byBasename: Map<string, Project> };

function resolveProject(cwd: string | undefined, index: ProjectIndex) {
  if (!cwd) return undefined;
  const exact = index.byPath.get(cwd);
  if (exact) return exact;
  const wtRepoName = cwd.match(/\.agents\/worktrees\/([^/]+)/)?.[1];
  return wtRepoName ? index.byBasename.get(wtRepoName) : undefined;
}

function LocationBadge({ project, folder }: { project?: Project; folder?: string }) {
  if (project) {
    return (
      <Badge
        variant="soft"
        className="h-[16px] px-1.5 py-0 text-[10px] rounded font-medium truncate max-w-[160px]"
        style={project.color ? { backgroundColor: `${project.color}18`, color: project.color } : undefined}
      >
        {project.name}
      </Badge>
    );
  }
  if (folder) {
    return (
      <span className="inline-flex items-center gap-0.5 truncate">
        <Folder className="h-2.5 w-2.5 shrink-0" />
        {folder}
      </span>
    );
  }
  return null;
}

interface CCCandidateItemProps {
  cc: { sessionId: string; fullPath: string; title?: string; firstPrompt?: string; cwd?: string; gitBranch?: string; lastModified: number };
  importing: boolean;
  disabled: boolean;
  cwdToProject: ProjectIndex;
  onSelect: (fullPath: string) => void;
}

function buildSearchValue(cc: CCCandidateItemProps['cc'], project?: Project, folder?: string, worktree?: string, branch?: string) {
  return [cc.title, cc.firstPrompt, project?.name, folder, worktree, branch].filter(Boolean).join(' ');
}

function CCCandidateItem({ cc, importing, disabled, cwdToProject, onSelect }: CCCandidateItemProps) {
  const { folder, worktree } = folderInfo(cc.cwd);
  const branch = cc.gitBranch && cc.gitBranch !== 'HEAD' ? cc.gitBranch : undefined;
  const project = resolveProject(cc.cwd, cwdToProject);

  return (
    <CommandItem
      value={buildSearchValue(cc, project, folder, worktree, branch)}
      onSelect={() => onSelect(cc.fullPath)}
      disabled={disabled}
      className="flex flex-col items-start gap-1 py-2 [&_svg]:!h-3 [&_svg]:!w-3"
    >
      <div className="flex items-center gap-2 w-full">
        {importing
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: CLAUDE_COLOR }} />
          : <div style={{ color: CLAUDE_COLOR }}><ClaudeIcon className="h-3.5 w-3.5 shrink-0" /></div>
        }
        <span className="flex-1 truncate text-sm">
          {cc.title || 'Untitled Session'}
        </span>
        <span className="text-[11px] text-neutral-fg-subtle/60 tabular-nums shrink-0">
          {timeAgo(cc.lastModified, 'verbose')}
        </span>
      </div>
      {(project || folder || branch || worktree) && (
        <div className="flex items-center gap-2 pl-[22px] text-[11px] text-neutral-fg-subtle/50">
          <LocationBadge project={project} folder={folder} />
          {worktree && (
            <Badge
              variant="soft"
              className="h-[16px] px-1.5 py-0 text-[10px] rounded font-medium truncate max-w-[140px] gap-0.5"
              style={{ backgroundColor: `${WORKTREE_COLOR}18`, color: WORKTREE_COLOR }}
            >
              <GitFork className="h-2.5 w-2.5 shrink-0" />
              {worktree}
            </Badge>
          )}
          {branch && (
            <Badge
              variant="soft"
              className="h-[16px] px-1.5 py-0 text-[10px] rounded font-medium truncate max-w-[180px] gap-0.5"
            >
              <GitBranch className="h-2.5 w-2.5 shrink-0" />
              {branch}
            </Badge>
          )}
        </div>
      )}
    </CommandItem>
  );
}

export function ImportCCDialog({ open, onOpenChange, orgId, onImported }: ImportCCDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [importingPath, setImportingPath] = useState<string | null>(null);
  // Track whether dialog is still open so onSuccess doesn't navigate after dismiss.
  const openRef = useRef(open);
  openRef.current = open;

  const { data: ccSessions = [], isLoading: discovering } = useQuery({
    ...trpc.session.discoverCC.queryOptions({}),
    enabled: open,
    staleTime: 5_000,
  });

  const { data: wfSessions = [] } = useQuery({
    ...trpc.session.list.queryOptions({ orgId }),
    enabled: open,
  });

  const importedCCIds = useMemo(
    () => new Set(
      wfSessions
        .filter((s) => s.metadata?.ccSessionId)
        .map((s) => s.metadata!.ccSessionId as string),
    ),
    [wfSessions],
  );

  const { data: projects = [] } = useQuery({
    ...trpc.project.list.queryOptions({ orgId }),
    enabled: open,
  });

  // rootPath → Project for matching CC sessions to WF projects.
  // Also index by basename for worktree matching (worktree cwds don't match rootPath directly).
  const cwdToProject = useMemo(() => {
    const byPath = new Map(projects.map((p: Project) => [p.rootPath, p]));
    const byBasename = new Map(projects.map((p: Project) => {
      const base = p.rootPath.split('/').filter(Boolean).pop();
      return base ? [base, p] as const : null;
    }).filter(Boolean) as [string, Project][]);
    return { byPath, byBasename };
  }, [projects]);

  const candidates = useMemo(
    () => ccSessions
      .filter((cc) => !importedCCIds.has(cc.sessionId))
      .sort((a, b) => b.lastModified - a.lastModified),
    [ccSessions, importedCCIds],
  );

  const allImported = !discovering && ccSessions.length > 0 && candidates.length === 0;

  const importMutation = useMutation(
    trpc.session.importCC.mutationOptions({
      onSuccess: async (imported) => {
        await queryClient.invalidateQueries({ queryKey: trpc.session.list.queryKey({ orgId }) });
        // Don't navigate if the user already dismissed the dialog.
        if (openRef.current) {
          onImported?.(imported.id);
          onOpenChange(false);
        }
        setImportingPath(null);
      },
      onError: (err) => {
        console.error('[ImportCCDialog] import failed:', err);
        setImportingPath(null);
      },
    }),
  );

  const handleSelect = (fullPath: string) => {
    if (importingPath) return;
    setImportingPath(fullPath);
    importMutation.mutate({ ccFilePath: fullPath, orgId });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setImportingPath(null);
    onOpenChange(next);
  };

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput placeholder="Search external sessions..." />
      <CommandList className="max-h-[400px]">
        {discovering && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-fg-subtle">
            <Loader2 className="h-4 w-4 animate-spin" />
            Discovering sessions...
          </div>
        )}
        {!discovering && (
          <CommandEmpty>
            {allImported ? 'All discovered sessions are already imported.' : 'No matching sessions found.'}
          </CommandEmpty>
        )}
        {!discovering && candidates.length > 0 && (
          <CommandGroup heading="Claude Code Sessions">
            {candidates.map((cc) => (
              <CCCandidateItem
                key={cc.sessionId}
                cc={cc}
                importing={importingPath === cc.fullPath}
                disabled={!!importingPath}
                cwdToProject={cwdToProject}
                onSelect={handleSelect}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

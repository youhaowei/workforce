/**
 * ChatInfoPanel - Right-side session info panel.
 *
 * Shows session metadata: name (editable), notes (editable), model, usage,
 * duration, files touched, and plan artifacts. Always visible in sessions view.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useSdkStore } from '@/ui/stores/useSdkStore';
import { useMessagesStore, type MessageState } from '@/ui/stores/useMessagesStore';
import type { ArtifactStatus } from '@/services/types';
import { MIME_DOT_COLOR, ARTIFACT_STATUS_STYLES, ARTIFACT_STATUS_LABELS } from '@/ui/lib/artifact-utils';
import { trpc as trpcClient } from '@/bridge/trpc';
import { FileText, Clock, Cpu, DollarSign, Pencil, GitBranch } from 'lucide-react';

// =============================================================================
// Helpers
// =============================================================================

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

function extractFilePaths(messages: MessageState[]): string[] {
  const paths = new Set<string>();
  for (const msg of messages) {
    if (!msg.toolActivities) continue;
    for (const activity of msg.toolActivities) {
      if (FILE_TOOLS.has(activity.name) && activity.input) {
        paths.add(activity.input);
      }
    }
  }
  return Array.from(paths);
}

function formatTokenCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
}

function formatCost(usd: number) {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

function shortenPath(path: string) {
  const parts = path.split('/');
  return parts.length > 1
    ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    : parts[parts.length - 1];
}

// =============================================================================
// Component
// =============================================================================

export interface ChatInfoPanelProps {
  isOpen: boolean;
  sessionId: string | null;
  /** Project rootPath for git status section. Null = no git section. */
  projectRootPath?: string | null;
  onOpenArtifact?: (artifactId: string) => void;
}

export function ChatInfoPanel({ isOpen, sessionId, projectRootPath, onOpenArtifact }: ChatInfoPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const cumulativeUsage = useSdkStore((s) => s.cumulativeUsage);
  const currentQueryStats = useSdkStore((s) => s.currentQueryStats);
  const systemInfo = useSdkStore((s) => s.systemInfo);
  const messages = useMessagesStore((s) => s.messages);

  const { data: session } = useQuery(
    trpc.session.get.queryOptions(
      { sessionId: sessionId! },
      { enabled: isOpen && !!sessionId },
    ),
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [notesValue, setNotesValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync session data to local state
  useEffect(() => {
    if (session) {
      setTitleValue(session.title ?? '');
      setNotesValue((session.metadata?.notes as string) ?? '');
    }
  }, [session]);

  const renameMutation = useMutation(
    trpc.session.rename.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const updateNotesMutation = useMutation(
    trpc.session.updateNotes.mutationOptions(),
  );

  const handleTitleBlur = useCallback(() => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (sessionId && trimmed && trimmed !== session?.title) {
      renameMutation.mutate({ sessionId, title: trimmed });
    }
  }, [sessionId, titleValue, session?.title, renameMutation]);

  const handleNotesChange = useCallback((value: string) => {
    setNotesValue(value);
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      if (sessionId) {
        updateNotesMutation.mutate({ sessionId, notes: value });
      }
    }, 500);
  }, [sessionId, updateNotesMutation]);

  // Flush pending notes mutation on session switch or unmount
  const sessionIdForFlush = useRef(sessionId);
  const notesValueRef = useRef(notesValue);
  sessionIdForFlush.current = sessionId;
  notesValueRef.current = notesValue;
  useEffect(() => {
    return () => {
      if (notesDebounceRef.current) {
        clearTimeout(notesDebounceRef.current);
        notesDebounceRef.current = null;
        if (sessionIdForFlush.current) {
          updateNotesMutation.mutate({ sessionId: sessionIdForFlush.current, notes: notesValueRef.current });
        }
      }
    };
  }, [sessionId, updateNotesMutation]);

  const filePaths = useMemo(() => extractFilePaths(messages), [messages]);

  const model = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].agentConfig?.model) {
        return messages[i].agentConfig!.model;
      }
    }
    return systemInfo?.model ?? '';
  }, [messages, systemInfo]);

  const hasUsage = cumulativeUsage.inputTokens > 0 || cumulativeUsage.outputTokens > 0;

  return (
    <div
      className={`flex-shrink-0 flex flex-col transition-[width] duration-200 ease-in-out select-none ${
        isOpen ? 'w-60' : 'w-0'
      }`}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
    >
      <div className="flex items-center h-10 px-3 gap-2">
        <h2 className="text-sm font-semibold text-neutral-fg flex-1 select-none">Info</h2>
      </div>

      <div className="p-3 space-y-4 overflow-y-auto flex-1 text-sm">
        {/* Name */}
        <Section label="Name">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.currentTarget.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleBlur();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="w-full bg-neutral-bg-dim/50 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-neutral-ring"
              autoFocus
            />
          ) : (
            <button
              className="w-full text-left text-neutral-fg hover:bg-neutral-bg-dim/50 rounded px-2 py-1 flex items-center gap-1 group"
              onClick={() => setEditingTitle(true)}
            >
              <span className="truncate flex-1">{session?.title || 'Untitled'}</span>
              <Pencil className="h-3 w-3 text-neutral-fg-subtle opacity-0 group-hover:opacity-100 flex-shrink-0" />
            </button>
          )}
        </Section>

        {/* Notes */}
        <Section label="Notes">
          <textarea
            value={notesValue}
            onChange={(e) => handleNotesChange(e.currentTarget.value)}
            placeholder="Add notes..."
            className="w-full bg-neutral-bg-dim/50 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-neutral-ring resize-none min-h-[60px] placeholder:text-neutral-fg-subtle/50"
            rows={3}
          />
        </Section>

        {/* Model */}
        {model && (
          <Section label="Model" icon={<Cpu className="h-3 w-3" />}>
            <p className="font-mono text-xs text-neutral-fg">{model}</p>
          </Section>
        )}

        {/* Usage */}
        {hasUsage && (
          <Section label="Usage" icon={<DollarSign className="h-3 w-3" />}>
            <div className="space-y-0.5 text-xs">
              <StatRow label="Input" value={formatTokenCount(cumulativeUsage.inputTokens)} />
              <StatRow label="Output" value={formatTokenCount(cumulativeUsage.outputTokens)} />
              {cumulativeUsage.cacheReadInputTokens > 0 && (
                <StatRow label="Cache" value={formatTokenCount(cumulativeUsage.cacheReadInputTokens)} />
              )}
              <StatRow label="Cost" value={formatCost(cumulativeUsage.totalCostUsd)} />
            </div>
          </Section>
        )}

        {/* Duration */}
        {currentQueryStats && (
          <Section label="Duration" icon={<Clock className="h-3 w-3" />}>
            <div className="space-y-0.5 text-xs">
              <StatRow label="Total" value={formatDuration(currentQueryStats.durationMs)} />
              <StatRow label="API time" value={formatDuration(currentQueryStats.durationApiMs)} />
              <StatRow label="Turns" value={String(currentQueryStats.numTurns)} />
            </div>
          </Section>
        )}

        {/* Files */}
        {filePaths.length > 0 && (
          <Section label={`Files (${filePaths.length})`} icon={<FileText className="h-3 w-3" />}>
            <div className="space-y-0.5">
              {filePaths.map((path) => (
                <div key={path} className="text-xs font-mono text-neutral-fg-subtle truncate" title={path}>
                  {shortenPath(path)}
                </div>
              ))}
            </div>
          </Section>
        )}

        {projectRootPath && (
          <GitSection cwd={projectRootPath} isOpen={isOpen} />
        )}

        {/* Artifacts */}
        <ArtifactsSection
          sessionId={sessionId}
          isOpen={isOpen}
          onOpenArtifact={onOpenArtifact}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function Section({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-neutral-fg-subtle flex items-center gap-1">
        {icon}
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-fg-subtle">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}



function StatusBadge({ status }: { status: string }) {
  const s = status as ArtifactStatus;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${ARTIFACT_STATUS_STYLES[s] ?? ''}`}>
      {ARTIFACT_STATUS_LABELS[s] ?? status}
    </span>
  );
}

function gitStatusColor(isStaged: boolean, area: string): string {
  if (isStaged) return 'text-palette-success';
  if (area === 'untracked') return 'text-neutral-fg-subtle';
  return 'text-palette-warning';
}

const STATUS_CHAR: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  unmerged: 'U',
};

function GitSection({ cwd, isOpen }: { cwd: string; isOpen: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: status } = useQuery(
    trpc.git.status.queryOptions(
      { cwd },
      { enabled: isOpen, staleTime: 5_000, refetchInterval: 10_000 },
    ),
  );

  const [commitMsg, setCommitMsg] = useState('');
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  if (!status) return null;

  const allChanges = [
    ...status.staged.map((f) => ({ ...f, area: 'staged' as const })),
    ...status.unstaged.map((f) => ({ ...f, area: 'unstaged' as const })),
    ...status.untracked.map((p) => ({ path: p, status: 'added' as const, area: 'untracked' as const })),
  ];

  const handleStage = async (file: string) => {
    await trpcClient.git.stage.mutate({ cwd, files: [file] });
    queryClient.invalidateQueries({ queryKey: trpc.git.status.queryKey({ cwd }) });
  };

  const handleUnstage = async (file: string) => {
    await trpcClient.git.unstage.mutate({ cwd, files: [file] });
    queryClient.invalidateQueries({ queryKey: trpc.git.status.queryKey({ cwd }) });
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || status.staged.length === 0) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await trpcClient.git.commit.mutate({ cwd, message: commitMsg.trim() });
      if (result.success) {
        setCommitMsg('');
        queryClient.invalidateQueries({ queryKey: trpc.git.status.queryKey({ cwd }) });
      } else {
        setCommitError(result.error ?? 'Commit failed');
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Section label={`Git (${status.branch})`} icon={<GitBranch className="h-3 w-3" />}>
      <div className="space-y-2">
        {status.isClean ? (
          <p className="text-xs text-neutral-fg-subtle">Working tree clean</p>
        ) : (
          <>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {allChanges.map((f) => {
                const filename = f.path.split('/').pop() ?? f.path;
                const isStaged = f.area === 'staged';
                return (
                  <button
                    key={`${f.area}-${f.path}`}
                    className="w-full text-left text-xs rounded px-1.5 py-0.5 hover:bg-neutral-bg-dim/50 flex items-center gap-1 group"
                    onClick={() => isStaged ? handleUnstage(f.path) : handleStage(f.path)}
                    title={`${f.path} (${f.area}) - click to ${isStaged ? 'unstage' : 'stage'}`}
                  >
                    <span className={`font-mono w-3 shrink-0 text-center ${
                      gitStatusColor(isStaged, f.area)
                    }`}>
                      {f.area === 'untracked' ? '?' : STATUS_CHAR[f.status] ?? '?'}
                    </span>
                    <span className="font-mono text-neutral-fg-subtle truncate flex-1">{filename}</span>
                    <span className="text-[10px] text-neutral-fg-subtle/50 opacity-0 group-hover:opacity-100">
                      {isStaged ? 'unstage' : 'stage'}
                    </span>
                  </button>
                );
              })}
            </div>

            {status.staged.length > 0 && (
              <div className="space-y-1">
                <input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommit(); } }}
                  placeholder="Commit message..."
                  className="w-full bg-neutral-bg-dim/50 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-neutral-ring placeholder:text-neutral-fg-subtle/50"
                  disabled={committing}
                />
                <button
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || committing}
                  className="w-full text-xs bg-palette-primary/90 text-white rounded px-2 py-1 hover:bg-palette-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {committing ? 'Committing...' : `Commit ${status.staged.length} file${status.staged.length !== 1 ? 's' : ''}`}
                </button>
                {commitError && (
                  <p className="text-xs text-palette-danger">{commitError}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function ArtifactsSection({
  sessionId,
  isOpen,
  onOpenArtifact,
}: {
  sessionId: string | null;
  isOpen: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const { data: artifacts = [] } = useQuery({
    queryKey: ['artifact', 'list', sessionId],
    queryFn: () => trpcClient.artifact.list.query({ sessionId: sessionId! }),
    enabled: isOpen && !!sessionId,
    staleTime: 30_000,
  });

  if (artifacts.length === 0) return null;

  return (
    <Section label={`Artifacts (${artifacts.length})`}>
      <div className="space-y-1">
        {artifacts.map((a) => {
          const filename = a.filePath.split('/').pop() ?? a.title;
          return (
            <button
              key={a.id}
              className="w-full text-left text-xs bg-neutral-bg-dim/50 rounded px-2 py-1.5 hover:bg-neutral-bg-dim flex items-center gap-1.5"
              onClick={() => onOpenArtifact?.(a.id)}
            >
              <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${MIME_DOT_COLOR[a.mimeType] ?? 'bg-neutral-fg-subtle'}`} />
              <span className="truncate flex-1 font-mono">{filename}</span>
              <StatusBadge status={a.status} />
            </button>
          );
        })}
      </div>
    </Section>
  );
}

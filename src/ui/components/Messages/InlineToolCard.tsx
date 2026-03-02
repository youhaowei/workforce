/**
 * InlineToolCard — Flat single-line tool row.
 *
 * Layout: StatusIcon · ToolName · [FileBadge] · [ErrorBadge] · Intent · InputSummary
 * Expandable detail on click (for results/errors).
 *
 * Styled after craft-agents-oss ActivityRow.
 */

import { useState, useMemo, useCallback, type KeyboardEvent } from 'react';
import { Check, X, ChevronRight, Loader2, Circle } from 'lucide-react';
import type { ContentBlock } from '@/services/types';
import { formatToolResult } from '@/ui/formatters';

type ToolBlock = ContentBlock & { type: 'tool_use' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBasename(path: string) {
  return path.split('/').pop() || path;
}

function trunc(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

function truncLines(s: string, max: number) {
  const lines = s.split('\n');
  if (lines.length <= max) return s;
  return lines.slice(0, max).join('\n') + `\n\u2026 ${lines.length - max} more lines`;
}

// ─── Smart summary per tool type ─────────────────────────────────────────────

interface ToolSummary {
  /** Primary display name (e.g. "Read CLAUDE.md", "Project structure") */
  displayName: string;
  /** File badge (e.g. "CLAUDE.md", "types.ts") */
  fileBadge?: string;
  /** Extra badges (e.g. subagent type for Task) */
  badges?: string[];
  /** Intent/description text */
  intent?: string;
  /** Raw input summary (faded, after intent) */
  inputSummary?: string;
  /** Whether this is a Task tool (rendered differently) */
  isTask?: boolean;
}

const FILE_OPS = new Set(['Read', 'Write', 'Edit']);

function summarizeFileOp(name: string, args: Record<string, unknown>, input: string): ToolSummary {
  const filePath = String(args.file_path ?? input);
  const base = getBasename(filePath);
  return { displayName: name, fileBadge: base };
}

function summarizeBash(args: Record<string, unknown>, input: string): ToolSummary {
  const desc = String(args.description ?? '');
  return { displayName: desc || 'Bash', inputSummary: trunc(String(args.command ?? input), 80) };
}

function summarizeGrep(args: Record<string, unknown>, input: string): ToolSummary {
  const pattern = String(args.pattern ?? input);
  const scope = args.path ? getBasename(String(args.path)) : undefined;
  return { displayName: 'Grep', intent: `"${pattern}"${scope ? ` in ${scope}` : ''}` };
}

function summarizeTask(args: Record<string, unknown>, input: string): ToolSummary {
  const desc = String(args.description ?? input);
  const subagentType = args.subagent_type ? String(args.subagent_type) : undefined;
  return { displayName: trunc(desc, 60), badges: subagentType ? [subagentType] : undefined, isTask: true };
}

function summarizeAskUser(args: Record<string, unknown>, input: string): ToolSummary {
  const questions = args.questions as Array<{ question?: string }> | undefined;
  const text = questions?.[0]?.question ?? input;
  return { displayName: 'Question', intent: trunc(text, 120) };
}

const TOOL_SUMMARIZERS: Record<string, (args: Record<string, unknown>, input: string) => ToolSummary> = {
  Bash: summarizeBash,
  Glob: (args, input) => ({ displayName: 'Glob', inputSummary: String(args.pattern ?? input) }),
  Grep: summarizeGrep,
  Task: summarizeTask,
  AskUserQuestion: summarizeAskUser,
};

function summarize(name: string, input: string, inputRaw?: unknown): ToolSummary {
  const args = (inputRaw ?? {}) as Record<string, unknown>;
  if (FILE_OPS.has(name)) return summarizeFileOp(name, args, input);
  const fn = TOOL_SUMMARIZERS[name];
  if (fn) return fn(args, input);
  return { displayName: name, inputSummary: input ? trunc(input, 80) : undefined };
}

// ─── Result badge ────────────────────────────────────────────────────────────

function getBashBadge(result: unknown): string | null {
  if (typeof result !== 'object') return null;
  const code = (result as { exitCode?: number }).exitCode;
  if (code === undefined) return null;
  return code === 0 ? 'success' : `exit ${code}`;
}

function getSearchBadge(name: string, result: unknown): string | null {
  if (typeof result !== 'object') return null;
  if (name === 'Glob') {
    const files = (result as { files?: unknown[] }).files;
    return files ? `${files.length} file${files.length !== 1 ? 's' : ''}` : null;
  }
  const r = result as { totalMatches?: number; matches?: unknown[] };
  const n = r.totalMatches ?? r.matches?.length ?? 0;
  return `${n} match${n !== 1 ? 'es' : ''}`;
}

const STATIC_BADGES: Record<string, string> = { Edit: 'applied', Write: 'written' };

function getResultBadge(name: string, result: unknown, error?: string): string | null {
  if (error || result == null) return null;
  if (name === 'Read' && typeof result === 'string') return `${result.split('\n').length} lines`;
  if (name in STATIC_BADGES) return STATIC_BADGES[name];
  if (name === 'Bash') return getBashBadge(result);
  if (name === 'Glob' || name === 'Grep') return getSearchBadge(name, result);
  return null;
}

// ─── Status icon ─────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ToolBlock['status'] }) {
  if (status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
  }
  if (status === 'error') {
    return (
      <span className="shrink-0 w-4 h-4 rounded-full bg-danger/15 inline-flex items-center justify-center">
        <X className="h-2.5 w-2.5 text-danger" />
      </span>
    );
  }
  if (status === 'complete') {
    return (
      <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-500/15 inline-flex items-center justify-center">
        <Check className="h-2.5 w-2.5 text-emerald-500" />
      </span>
    );
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
}

// ─── Detail content ──────────────────────────────────────────────────────────

function DetailContent({ error, detail }: { error?: string; detail: string }) {
  if (error) {
    return <pre className="text-[11px] font-mono text-danger whitespace-pre-wrap">{error}</pre>;
  }
  if (detail) {
    return (
      <pre className="text-[11px] font-mono text-muted-foreground/60 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto leading-relaxed">
        {truncLines(detail, 30)}
      </pre>
    );
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function InlineToolCard({ block }: { block: ToolBlock }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((p) => !p), []);
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
    [toggle],
  );

  const info = useMemo(
    () => summarize(block.name, block.input, block.inputRaw),
    [block.name, block.input, block.inputRaw],
  );

  const badge = useMemo(
    () => getResultBadge(block.name, block.result, block.error),
    [block.name, block.result, block.error],
  );

  const detail = useMemo(() => {
    if (block.error) return block.error;
    if (!block.result) return '';
    const f = formatToolResult(block.name, block.result);
    return f.detail || f.summary || (typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2));
  }, [block.name, block.result, block.error]);

  const expandable = detail.length > 0;

  return (
    <div>
      {/* Flat tool row */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle ${block.name} details`}
        className="group/row flex items-center gap-2 py-0.5 cursor-pointer select-none text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <StatusIcon status={block.status} />

        {/* Display name */}
        <span className="shrink-0 font-medium">
          {info.displayName}
        </span>

        {/* File badge */}
        {info.fileBadge && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground">
            {info.fileBadge}
          </span>
        )}

        {/* Extra badges (subagent type, etc.) */}
        {info.badges?.map((b) => (
          <span
            key={b}
            className="shrink-0 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground"
          >
            {b}
          </span>
        ))}

        {/* Error badge */}
        {block.status === 'error' && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-danger/10 text-[10px] font-medium text-danger">
            Error
          </span>
        )}

        {/* Intent + input summary (truncated, faded) */}
        <span className="truncate flex-1 min-w-0">
          {info.intent && (
            <>
              <span className="opacity-50"> &middot; </span>
              <span>{info.intent}</span>
            </>
          )}
          {info.inputSummary && (
            <>
              <span className="opacity-50"> &middot; </span>
              <span className="opacity-40">{info.inputSummary}</span>
            </>
          )}
        </span>

        {/* Result badge */}
        {badge && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50 font-mono tabular-nums">
            {badge}
          </span>
        )}

        {/* Expand chevron */}
        {expandable && (
          <ChevronRight
            className={`h-3 w-3 text-muted-foreground/40 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </div>

      {/* Expandable detail */}
      {expanded && expandable && (
        <div className="ml-6 pl-2 border-l-2 border-muted py-1.5">
          <DetailContent error={block.error} detail={detail} />
        </div>
      )}
    </div>
  );
}

/**
 * DiffViewer - Workforce wrapper around @pierre/diffs PatchDiff.
 *
 * Renders a unified diff patch string with syntax highlighting, split/unified
 * toggle, and OKLCH theme token integration via unsafeCSS.
 */

import { useMemo, useState } from 'react';
import { PatchDiff, Virtualizer } from '@pierre/diffs/react';
import type { FileDiffMetadata } from '@pierre/diffs/react';
import { parsePatchFiles } from '@pierre/diffs';
import { Columns2, Rows3, WrapText } from 'lucide-react';

/**
 * CSS injected into pierre's Shadow DOM to map our OKLCH tokens
 * into its internal CSS variables.
 */
const UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: var(--neutral-bg-muted) !important;
  --diffs-light-bg: var(--neutral-bg-muted) !important;
  --diffs-dark-bg: var(--neutral-bg-muted) !important;

  --diffs-bg-context-override: var(--neutral-bg);
  --diffs-bg-hover-override: var(--neutral-bg-subtle);
  --diffs-bg-separator-override: var(--neutral-bg-emphasis);
  --diffs-bg-buffer-override: var(--neutral-bg-muted);

  --diffs-bg-addition-override: color-mix(in oklch, var(--neutral-bg) 90%, var(--palette-success));
  --diffs-bg-addition-number-override: color-mix(in oklch, var(--neutral-bg) 84%, var(--palette-success));
  --diffs-bg-addition-hover-override: color-mix(in oklch, var(--neutral-bg) 78%, var(--palette-success));
  --diffs-bg-addition-emphasis-override: color-mix(in oklch, var(--neutral-bg) 70%, var(--palette-success));

  --diffs-bg-deletion-override: color-mix(in oklch, var(--neutral-bg) 90%, var(--palette-danger));
  --diffs-bg-deletion-number-override: color-mix(in oklch, var(--neutral-bg) 84%, var(--palette-danger));
  --diffs-bg-deletion-hover-override: color-mix(in oklch, var(--neutral-bg) 78%, var(--palette-danger));
  --diffs-bg-deletion-emphasis-override: color-mix(in oklch, var(--neutral-bg) 70%, var(--palette-danger));

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: var(--neutral-bg-emphasis) !important;
  border-block-color: var(--neutral-border) !important;
  color: var(--neutral-fg) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--neutral-bg-emphasis) !important;
  border-bottom: 1px solid var(--neutral-border) !important;
}

[data-column-number] {
  color: var(--neutral-fg-subtle) !important;
}
`;

type DiffStyle = 'unified' | 'split';

export interface DiffViewerProps {
  /** Unified diff patch string (from git diff) */
  patch: string;
  /** Show diff in dark mode (follows app theme) */
  isDark?: boolean;
}

export function DiffViewer({ patch, isDark }: DiffViewerProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  const themeType = isDark ? 'dark' : 'light';
  const themeName = isDark ? 'pierre-dark' : 'pierre-light';

  const options = useMemo(
    () => ({
      theme: themeName,
      themeType: themeType as 'light' | 'dark',
      diffStyle,
      diffIndicators: 'bars' as const,
      lineDiffType: diffStyle === 'split' ? ('word-alt' as const) : ('none' as const),
      overflow: wordWrap ? ('wrap' as const) : ('scroll' as const),
      unsafeCSS: UNSAFE_CSS,
      expandUnchanged: true,
      expansionLineCount: 20,
    }),
    [themeName, themeType, diffStyle, wordWrap],
  );

  if (!patch.trim()) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-fg-subtle text-sm">
        No changes
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-border flex-shrink-0">
        <div className="flex items-center border border-neutral-border rounded-md overflow-hidden">
          <button
            onClick={() => setDiffStyle('unified')}
            className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${
              diffStyle === 'unified'
                ? 'bg-neutral-bg-emphasis text-neutral-fg'
                : 'text-neutral-fg-subtle hover:text-neutral-fg'
            }`}
            title="Unified view"
          >
            <Rows3 className="h-3 w-3" />
          </button>
          <button
            onClick={() => setDiffStyle('split')}
            className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${
              diffStyle === 'split'
                ? 'bg-neutral-bg-emphasis text-neutral-fg'
                : 'text-neutral-fg-subtle hover:text-neutral-fg'
            }`}
            title="Split view"
          >
            <Columns2 className="h-3 w-3" />
          </button>
        </div>
        <button
          onClick={() => setWordWrap((v) => !v)}
          className={`px-2 py-1 text-xs border border-neutral-border rounded-md flex items-center gap-1 transition-colors ${
            wordWrap
              ? 'bg-neutral-bg-emphasis text-neutral-fg'
              : 'text-neutral-fg-subtle hover:text-neutral-fg'
          }`}
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        >
          <WrapText className="h-3 w-3" />
        </button>
      </div>

      {/* Diff content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <PatchDiff
          patch={patch}
          options={options}
          className="min-h-full"
        />
      </div>
    </div>
  );
}

/**
 * MultiFileDiffViewer - Renders multiple file diffs from a patch using Virtualizer.
 * Used for branch-level diffs with many files.
 */
export interface MultiFileDiffViewerProps {
  patch: string;
  isDark?: boolean;
  /** File to scroll to on mount */
  focusFile?: string;
}

export function MultiFileDiffViewer({ patch, isDark, focusFile }: MultiFileDiffViewerProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  const themeType = isDark ? 'dark' : 'light';
  const themeName = isDark ? 'pierre-dark' : 'pierre-light';

  const options = useMemo(
    () => ({
      theme: themeName,
      themeType: themeType as 'light' | 'dark',
      diffStyle,
      diffIndicators: 'bars' as const,
      lineDiffType: diffStyle === 'split' ? ('word-alt' as const) : ('none' as const),
      overflow: wordWrap ? ('wrap' as const) : ('scroll' as const),
      unsafeCSS: UNSAFE_CSS,
      expandUnchanged: true,
      expansionLineCount: 20,
    }),
    [themeName, themeType, diffStyle, wordWrap],
  );

  const files = useMemo(() => {
    if (!patch.trim()) return [];
    try {
      const parsed = parsePatchFiles(patch);
      return parsed.flatMap((p) => p.files);
    } catch {
      return [];
    }
  }, [patch]);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-fg-subtle text-sm">
        No changes
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-border flex-shrink-0">
        <span className="text-xs text-neutral-fg-subtle mr-auto">
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>
        <div className="flex items-center border border-neutral-border rounded-md overflow-hidden">
          <button
            onClick={() => setDiffStyle('unified')}
            className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${
              diffStyle === 'unified'
                ? 'bg-neutral-bg-emphasis text-neutral-fg'
                : 'text-neutral-fg-subtle hover:text-neutral-fg'
            }`}
            title="Unified view"
          >
            <Rows3 className="h-3 w-3" />
          </button>
          <button
            onClick={() => setDiffStyle('split')}
            className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${
              diffStyle === 'split'
                ? 'bg-neutral-bg-emphasis text-neutral-fg'
                : 'text-neutral-fg-subtle hover:text-neutral-fg'
            }`}
            title="Split view"
          >
            <Columns2 className="h-3 w-3" />
          </button>
        </div>
        <button
          onClick={() => setWordWrap((v) => !v)}
          className={`px-2 py-1 text-xs border border-neutral-border rounded-md flex items-center gap-1 transition-colors ${
            wordWrap
              ? 'bg-neutral-bg-emphasis text-neutral-fg'
              : 'text-neutral-fg-subtle hover:text-neutral-fg'
          }`}
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        >
          <WrapText className="h-3 w-3" />
        </button>
      </div>

      {/* Multi-file diff with virtualizer */}
      <Virtualizer
        className="flex-1 min-h-0 overflow-auto px-2 pb-2"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        {files.map((fileDiff) => (
          <FileDiffItem
            key={fileDiff.cacheKey ?? fileDiff.name ?? fileDiff.prevName}
            fileDiff={fileDiff}
            options={options}
            isFocused={
              focusFile != null &&
              (fileDiff.name === focusFile || fileDiff.prevName === focusFile)
            }
          />
        ))}
      </Virtualizer>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { FileDiff } from '@pierre/diffs/react';

function FileDiffItem({
  fileDiff,
  options,
  isFocused,
}: {
  fileDiff: FileDiffMetadata;
  options: Record<string, unknown>;
  isFocused: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isFocused]);

  return (
    <div ref={ref} className="mb-2 rounded-md first:mt-2 last:mb-0">
      <FileDiff fileDiff={fileDiff} options={options} />
    </div>
  );
}

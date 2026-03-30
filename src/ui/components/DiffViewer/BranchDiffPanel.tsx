/**
 * BranchDiffPanel - Resizable panel for viewing branch-level diffs.
 *
 * Occupies the same slot as ArtifactPanel. Shows multi-file diff from the
 * current branch vs its base branch, using @pierre/diffs for rendering.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { X, GitBranch, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { MultiFileDiffViewer } from './DiffViewer';
import { useThemeStore, resolveIsDark } from '@/ui/stores/useThemeStore';

const STORAGE_KEY = 'workforce:diff-panel-width';
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 400;
const MAX_WIDTH = 1400;

export interface BranchDiffPanelProps {
  isOpen: boolean;
  patch: string;
  branch: string;
  baseBranch: string;
  fileCount: number;
  isLoading: boolean;
  focusFile?: string | null;
  onClose: () => void;
}

function getInitialWidth(storageKey: string, defaultWidth: number) {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return defaultWidth;
  const n = parseInt(stored, 10);
  return Number.isNaN(n) ? defaultWidth : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
}

export function BranchDiffPanel({
  isOpen,
  patch,
  branch,
  baseBranch,
  fileCount,
  isLoading,
  focusFile,
  onClose,
}: BranchDiffPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => getInitialWidth(STORAGE_KEY, DEFAULT_WIDTH));
  const [dragging, setDragging] = useState(false);
  const dragHandlersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);
  const isDark = useThemeStore((s) => resolveIsDark(s.mode, s.previewMode));

  useEffect(() => {
    return () => {
      if (dragHandlersRef.current) {
        document.removeEventListener('mousemove', dragHandlersRef.current.onMove);
        document.removeEventListener('mouseup', dragHandlersRef.current.onUp);
      }
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = panelRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.offsetWidth;
    setDragging(true);

    function onMove(ev: MouseEvent) {
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW - (ev.clientX - startX)));
      el!.style.flexBasis = w + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragHandlersRef.current = null;
      const finalW = el!.offsetWidth;
      setWidth(finalW);
      setDragging(false);
      localStorage.setItem(STORAGE_KEY, String(finalW));
    }
    dragHandlersRef.current = { onMove, onUp };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      ref={panelRef}
      className={`shrink flex overflow-hidden select-none ${
        dragging ? '' : 'transition-[width,margin] duration-200 ease-in-out'
      } ${isOpen ? '' : 'w-0 !m-0'}`}
      style={isOpen ? { flexBasis: `${width}px`, minWidth: `${MIN_WIDTH}px` } : undefined}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
    >
      {/* Resize handle */}
      <div
        className="w-1 cursor-col-resize flex-shrink-0 hover:bg-palette-primary/60 active:bg-palette-primary transition-colors z-10"
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />
      {/* Panel content */}
      <Surface
        variant="panel"
        className="flex-1 flex flex-col min-w-0 rounded-[var(--inner-radius)] shadow-[var(--inner-shadow)]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-10 flex-shrink-0 border-b border-neutral-border">
          <GitBranch className="h-4 w-4 text-neutral-fg-subtle flex-shrink-0" />
          <span className="text-sm font-semibold text-neutral-fg truncate flex-1">
            {branch}
            <span className="text-neutral-fg-subtle font-normal"> vs </span>
            {baseBranch}
          </span>
          {fileCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 bg-palette-info/20 text-palette-info">
              {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={onClose} title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-neutral-fg-subtle">
            <Loader2 className="h-6 w-6 animate-spin text-palette-primary/60" />
            <p className="text-sm">Loading branch diff...</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <MultiFileDiffViewer
              patch={patch}
              isDark={isDark}
              focusFile={focusFile ?? undefined}
            />
          </div>
        )}
      </Surface>
    </div>
  );
}

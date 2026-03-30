/**
 * ArtifactPanel - Resizable panel for viewing and reviewing workspace artifacts.
 *
 * Replaces PlanPanel. Shows artifact content with inline comments, review box,
 * and artifact tabs in the header. Supports plan mode's approve/reject flow.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import type { ArtifactStatus, ArtifactComment, Artifact } from '@/services/types';
import { ArtifactHeader } from './ArtifactHeader';
import { ArtifactContent } from './ArtifactContent';
import { ArtifactReviewBox } from './ArtifactReviewBox';

const STORAGE_KEY = 'workforce:artifact-panel-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1200;

export interface ArtifactPanelProps {
  isOpen: boolean;
  isPlanMode: boolean;
  isPlanArtifact: boolean;
  title: string;
  filePath: string;
  status: ArtifactStatus;
  content: string;
  loadError?: string | null;
  comments: ArtifactComment[];
  sessionArtifacts: Artifact[];
  activeArtifactId: string | null;
  onAddComment: (line: number, text: string, severity: ArtifactComment['severity']) => void;
  onSubmitReview: (summary: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
  onSelectArtifact: (id: string) => void;
}

function WaitingState({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 h-10 flex-shrink-0">
        <FileText className="h-4 w-4 text-neutral-fg-subtle flex-shrink-0" />
        <span className="text-sm font-semibold text-neutral-fg flex-1">Plan Mode</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 bg-palette-info/20 text-palette-info">
          Active
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-neutral-fg-subtle">
        <Loader2 className="h-6 w-6 animate-spin text-palette-primary/60" />
        <p className="text-sm">Agent is researching and drafting a plan...</p>
        <p className="text-xs max-w-[280px] text-center">The plan will appear here for your review when ready.</p>
      </div>
    </>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-palette-danger text-sm px-6">
      Failed to load artifact: {error}
    </div>
  );
}

function PanelContent(props: Omit<ArtifactPanelProps, 'isOpen'>) {
  const {
    isPlanMode, isPlanArtifact, title, filePath, status, content, loadError,
    comments, sessionArtifacts, activeArtifactId,
    onAddComment, onSubmitReview, onApprove, onReject, onClose, onSelectArtifact,
  } = props;

  if (content || loadError) {
    return (
      <>
        <ArtifactHeader
          title={title}
          filePath={filePath}
          status={status}
          artifacts={sessionArtifacts}
          activeArtifactId={activeArtifactId}
          onSelectArtifact={onSelectArtifact}
          onClose={onClose}
        />

        {loadError ? (
          <ErrorState error={loadError} />
        ) : (
          <ArtifactContent content={content} comments={comments} onAddComment={onAddComment} />
        )}

        {status === 'pending_review' && (
          <ArtifactReviewBox
            comments={comments}
            artifactTitle={title}
            isPlanArtifact={isPlanArtifact}
            onSubmitReview={onSubmitReview}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
      </>
    );
  }

  if (isPlanMode) {
    return <WaitingState onClose={onClose} />;
  }

  return null;
}

function getInitialWidth(storageKey: string, defaultWidth: number) {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return defaultWidth;
  const n = parseInt(stored, 10);
  return Number.isNaN(n) ? defaultWidth : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
}

export function ArtifactPanel({ isOpen, ...rest }: ArtifactPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => getInitialWidth(STORAGE_KEY, DEFAULT_WIDTH));
  const [dragging, setDragging] = useState(false);
  const dragHandlersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);

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
      setWidth(finalW); // sync React state so re-renders don't snap back
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
        <PanelContent {...rest} />
      </Surface>
    </div>
  );
}

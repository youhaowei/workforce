/**
 * PlanPanel - Slide-in panel for reviewing agent-generated plans.
 *
 * Mirrors TaskPanel's transition pattern: width-based slide with overflow-hidden.
 * Positioned between MainContentColumn and ChatInfoPanel in Shell's flex layout.
 *
 * Shows a "waiting" state when plan mode is active but no plan has arrived yet.
 */

import { FileText, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentPermissionMode, PlanArtifact } from '@/services/types';
import { PlanHeader } from './PlanHeader';
import { PlanContent } from './PlanContent';
import { PlanFooter } from './PlanFooter';

export interface PlanPanelProps {
  isOpen: boolean;
  isPlanMode: boolean;
  artifact: PlanArtifact | null;
  content: string;
  loadError?: string | null;
  onApprove: (permission: AgentPermissionMode) => void;
  onReject: () => void;
  onClose: () => void;
}

function PlanWaiting({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Plan Mode</h2>
          <span className="text-xs text-muted-foreground">Waiting for agent to produce a plan</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-blue-500/20 text-blue-600 dark:text-blue-400">
          Active
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500/60" />
        <p className="text-sm">Agent is researching and drafting a plan...</p>
        <p className="text-xs max-w-[280px] text-center">The plan will appear here for your review when ready.</p>
      </div>
    </>
  );
}

function PlanPanelContent({ artifact, isPlanMode, content, loadError, onApprove, onReject, onClose }: Omit<PlanPanelProps, 'isOpen'>) {
  if (artifact) {
    return (
      <>
        <PlanHeader title={artifact.title} filePath={artifact.path} status={artifact.status} onClose={onClose} />
        <PlanContent content={content} error={loadError} />
        <PlanFooter status={artifact.status} onApprove={onApprove} onReject={onReject} />
      </>
    );
  }
  if (isPlanMode) {
    return <PlanWaiting onClose={onClose} />;
  }
  return null;
}

export function PlanPanel({ isOpen, ...rest }: PlanPanelProps) {
  return (
    <div
      data-collapsed={!isOpen || undefined}
      className={`flex-shrink-0 flex flex-col inner-panel transition-[width,margin] duration-200 ease-in-out overflow-hidden m-[var(--inner-gap)] ${
        isOpen ? 'w-[480px]' : 'w-0 !m-0'
      }`}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
    >
      <PlanPanelContent {...rest} />
    </div>
  );
}

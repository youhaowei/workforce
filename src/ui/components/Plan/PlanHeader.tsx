/**
 * PlanHeader - Top bar of the plan panel with title, file path, and status.
 */

import { X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlanArtifactStatus } from '@/services/types';

interface PlanHeaderProps {
  title: string;
  filePath: string;
  status: PlanArtifactStatus;
  onClose: () => void;
}

const STATUS_STYLES: Record<PlanArtifactStatus, string> = {
  pending_review: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  approved: 'bg-green-500/20 text-green-600 dark:text-green-400',
  rejected: 'bg-red-500/20 text-red-600 dark:text-red-400',
  executing: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
};

const STATUS_LABELS: Record<PlanArtifactStatus, string> = {
  pending_review: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  executing: 'Executing',
};

export function PlanHeader({ title, filePath, status, onClose }: PlanHeaderProps) {
  const filename = filePath.split('/').pop() ?? filePath;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-neutral-bg-subtle">
      <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-neutral-fg truncate">{title}</h2>
        <span className="text-xs font-mono text-neutral-fg-subtle truncate block" title={filePath}>
          {filename}
        </span>
      </div>

      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_STYLES[status]}`}>
        {STATUS_LABELS[status]}
      </span>

      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose} title="Close plan">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

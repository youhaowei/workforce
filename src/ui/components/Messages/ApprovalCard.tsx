/**
 * ApprovalCard — Inline card for tool approval requests.
 *
 * Shows tool name, input summary, and 4 action buttons:
 * Approve / Always (approve_session) / Deny / Cancel.
 *
 * After a decision is submitted, shows a read-only chip with the outcome.
 */

import { useCallback } from 'react';
import { ShieldCheck, ShieldOff, X, CheckCheck } from 'lucide-react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { useApprovalStore } from '@/ui/stores/useApprovalStore';
import type { ApprovalDecision } from '@/ui/stores/useApprovalStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
/** Simple input summary for display. */
function summarizeInput(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const KEY_MAP: Record<string, string> = {
    Read: 'file_path', Edit: 'file_path', Write: 'file_path',
    Bash: 'command', Glob: 'pattern',
  };
  const key = KEY_MAP[toolName];
  if (key && args[key]) return String(args[key]).slice(0, 80);
  if (toolName === 'Grep') {
    const suffix = args.path ? ` in ${args.path}` : '';
    return `${args.pattern ?? ''}${suffix}`.slice(0, 80);
  }
  return JSON.stringify(input ?? '').slice(0, 80);
}

const DECISION_LABELS: Record<ApprovalDecision, string> = {
  approve: 'Approved',
  approve_session: 'Always Allow',
  deny: 'Denied',
  cancel: 'Cancelled',
};

const DECISION_STYLES: Record<ApprovalDecision, string> = {
  approve: 'bg-palette-success/10 text-palette-success',
  approve_session: 'bg-palette-success/10 text-palette-success',
  deny: 'bg-palette-danger/10 text-palette-danger',
  cancel: 'bg-neutral-bg-dim/50 text-neutral-fg-subtle',
};

export function ApprovalCard() {
  const pending = useApprovalStore((s) => s.pending);
  const submittedDecision = useApprovalStore((s) => s.submittedDecision);

  const handleDecision = useCallback((decision: ApprovalDecision) => {
    if (!pending) return;
    useApprovalStore.getState().submit(decision);
    trpcClient.agent.submitApproval.mutate({
      requestId: pending.requestId,
      decision,
    }).catch((err) => console.warn('[ApprovalCard] submitApproval failed:', err));
  }, [pending]);

  if (!pending) return null;

  // Already submitted — show read-only chip
  if (submittedDecision) {
    return (
      <Card className="mx-2 my-1.5 px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-neutral-fg-subtle" />
          <span className="text-xs text-neutral-fg-subtle">{pending.toolName}</span>
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${DECISION_STYLES[submittedDecision]}`}>
            {DECISION_LABELS[submittedDecision]}
          </span>
        </div>
      </Card>
    );
  }

  const inputSummary = summarizeInput(pending.toolName, pending.input);

  return (
    <Card className="mx-2 my-1.5 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-palette-primary" />
        <span className="text-xs font-medium text-neutral-fg">Permission Required</span>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-neutral-fg">
          <span className="font-medium">{pending.toolName}</span>
        </div>
        {inputSummary && (
          <div className="text-[11px] text-neutral-fg-subtle font-mono truncate max-w-[400px]" title={inputSummary}>
            {inputSummary}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button size="xs" color="success" className="gap-1" onClick={() => handleDecision('approve')}>
          <ShieldCheck className="h-3 w-3" />
          Approve
        </Button>
        <Button size="xs" variant="soft" color="success" className="gap-1" onClick={() => handleDecision('approve_session')}>
          <CheckCheck className="h-3 w-3" />
          Always
        </Button>
        <Button size="xs" variant="soft" color="danger" className="gap-1" onClick={() => handleDecision('deny')}>
          <ShieldOff className="h-3 w-3" />
          Deny
        </Button>
        <Button size="xs" variant="ghost" className="gap-1" onClick={() => handleDecision('cancel')}>
          <X className="h-3 w-3" />
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/**
 * PlanFooter - Approve (split button with permission dropdown) and Reject controls.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, X, ChevronDown } from 'lucide-react';
import type { AgentPermissionMode, PlanArtifactStatus } from '@/services/types';

interface PlanFooterProps {
  status: PlanArtifactStatus;
  onApprove: (permission: AgentPermissionMode) => void;
  onReject: () => void;
}

const PERMISSION_OPTIONS: Array<{ value: AgentPermissionMode; label: string; description: string }> = [
  { value: 'default', label: 'Ask', description: 'Prompt before each tool use' },
  { value: 'acceptEdits', label: 'Auto-Edit', description: 'Auto-approve file edits' },
  { value: 'bypassPermissions', label: 'Full Auto', description: 'Skip all permission checks' },
];

export function PlanFooter({ status, onApprove, onReject }: PlanFooterProps) {
  const [selectedPermission, setSelectedPermission] = useState<AgentPermissionMode>('acceptEdits');
  const isPending = status === 'pending_review';

  if (!isPending) return null;

  const selectedOption = PERMISSION_OPTIONS.find((o) => o.value === selectedPermission) ?? PERMISSION_OPTIONS[1];

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t bg-card">
      {/* Approve split button */}
      <div className="flex items-center rounded-md overflow-hidden">
        <Button
          size="sm"
          className="rounded-r-none gap-1.5"
          onClick={() => onApprove(selectedPermission)}
        >
          <Check className="h-3.5 w-3.5" />
          Approve ({selectedOption.label})
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-1.5">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {PERMISSION_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setSelectedPermission(option.value)}
                className="flex flex-col items-start"
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Reject */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onReject}
      >
        <X className="h-3.5 w-3.5" />
        Reject
      </Button>
    </div>
  );
}

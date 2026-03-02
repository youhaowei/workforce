/**
 * WorkflowStepItem - Individual step row in the workflow editor.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, Trash2, X } from 'lucide-react';
import type { WorkflowStep } from '@/services/types';

interface WorkflowStepItemProps {
  step: WorkflowStep;
  index: number;
  /** All steps in the workflow — needed for parallel_group child selection */
  allSteps?: WorkflowStep[];
  onChange: (step: WorkflowStep) => void;
  onDelete: () => void;
}

function typeVariant(type: string): { variant?: 'soft' | 'outline'; color?: 'primary' } {
  switch (type) {
    case 'agent': return { color: 'primary' };
    case 'review_gate': return { variant: 'soft' };
    case 'parallel_group': return { variant: 'outline' };
    default: return { variant: 'outline' };
  }
}

export function WorkflowStepItem({ step, index, allSteps = [], onChange, onDelete }: WorkflowStepItemProps) {
  // For parallel_group: eligible child steps are agent or review_gate steps (not other parallel_groups)
  const eligibleChildren = allSteps.filter(
    (s) => s.id !== step.id && (s.type === 'agent' || s.type === 'review_gate'),
  );
  const selectedChildren = step.parallelStepIds ?? [];

  const toggleChild = (childId: string) => {
    const current = new Set(selectedChildren);
    if (current.has(childId)) {
      current.delete(childId);
    } else {
      current.add(childId);
    }
    onChange({ ...step, parallelStepIds: Array.from(current) });
  };

  return (
    <div className="flex flex-col gap-1.5 p-2 border rounded-lg bg-neutral-bg-subtle group">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-neutral-fg-subtle shrink-0 cursor-grab" />
        <span className="text-xs text-neutral-fg-subtle w-6 shrink-0">{index + 1}</span>
        <Badge {...typeVariant(step.type)} className="text-[10px] shrink-0">
          {step.type.replace('_', ' ')}
        </Badge>
        <Input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="h-7 text-sm flex-1"
          placeholder="Step name"
        />
        {step.type === 'agent' && (
          <Input
            value={step.goal ?? ''}
            onChange={(e) => onChange({ ...step, goal: e.target.value })}
            className="h-7 text-sm flex-1"
            placeholder="Goal"
          />
        )}
        {step.type === 'review_gate' && (
          <Input
            value={step.reviewPrompt ?? ''}
            onChange={(e) => onChange({ ...step, reviewPrompt: e.target.value })}
            className="h-7 text-sm flex-1"
            placeholder="Review prompt"
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 text-palette-danger" />
        </Button>
      </div>

      {step.type === 'parallel_group' && (
        <div className="ml-12 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] font-medium text-neutral-fg-subtle">Children:</span>
          {selectedChildren.map((childId) => {
            const child = allSteps.find((s) => s.id === childId);
            return (
              <Badge key={childId} variant="soft" className="text-[10px] gap-1 pr-1">
                {child?.name ?? childId}
                <button onClick={() => toggleChild(childId)} className="hover:text-palette-danger">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            );
          })}
          {eligibleChildren.filter((s) => !selectedChildren.includes(s.id)).length > 0 && (
            <select
              className="h-6 text-[10px] bg-neutral-bg-dim border rounded px-1"
              value=""
              onChange={(e) => { if (e.target.value) toggleChild(e.target.value); }}
            >
              <option value="">+ Add step...</option>
              {eligibleChildren
                .filter((s) => !selectedChildren.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

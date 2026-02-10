/**
 * WorkflowStepItem - Individual step row in the workflow editor.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, Trash2 } from 'lucide-react';
import type { WorkflowStep } from '@services/types';

interface WorkflowStepItemProps {
  step: WorkflowStep;
  index: number;
  onChange: (step: WorkflowStep) => void;
  onDelete: () => void;
}

function typeVariant(type: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (type) {
    case 'agent': return 'default';
    case 'review_gate': return 'secondary';
    case 'parallel_group': return 'outline';
    default: return 'outline';
  }
}

export function WorkflowStepItem({ step, index, onChange, onDelete }: WorkflowStepItemProps) {
  return (
    <div className="flex items-center gap-2 p-2 border rounded-lg bg-card group">
      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />
      <span className="text-xs text-muted-foreground w-6 shrink-0">{index + 1}</span>
      <Badge variant={typeVariant(step.type)} className="text-[10px] shrink-0">
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
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

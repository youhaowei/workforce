/**
 * WorkflowCard - Card displaying a workflow template.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Play, Pencil, Archive } from 'lucide-react';
import type { WorkflowTemplate, StepType } from '@/services/types';

interface WorkflowCardProps {
  workflow: WorkflowTemplate;
  onExecute?: (workflow: WorkflowTemplate) => void;
  onEdit?: (workflow: WorkflowTemplate) => void;
  onArchive?: (workflow: WorkflowTemplate) => void;
}

function countByType(steps: { type: StepType }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of steps) {
    counts[s.type] = (counts[s.type] || 0) + 1;
  }
  return counts;
}

export function WorkflowCard({ workflow, onExecute, onEdit, onArchive }: WorkflowCardProps) {
  const counts = countByType(workflow.steps);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium truncate">{workflow.name}</h3>
            <p className="text-xs text-neutral-fg-subtle line-clamp-2 mt-0.5">{workflow.description}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(workflow)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchive?.(workflow)} className="text-palette-danger">
                <Archive className="h-3.5 w-3.5 mr-2" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <Badge variant="outline" className="text-[10px]">
            {workflow.steps.length} steps
          </Badge>
          {counts.agent && (
            <Badge color="primary" className="text-[10px]">{counts.agent} agents</Badge>
          )}
          {counts.review_gate && (
            <Badge variant="soft" className="text-[10px]">{counts.review_gate} gates</Badge>
          )}
          {counts.parallel_group && (
            <Badge variant="outline" className="text-[10px]">{counts.parallel_group} parallel</Badge>
          )}
        </div>

        <Button size="sm" className="w-full" onClick={() => onExecute?.(workflow)}>
          <Play className="h-3 w-3 mr-1.5" />
          Run Workflow
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * WorkflowEditor - Dialog for creating/editing workflow templates.
 * Manages a step list with dependency support.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { useWorkspaceStore } from '@ui/stores/useWorkspaceStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus } from 'lucide-react';
import { WorkflowStepItem } from './WorkflowStepItem';
import type { WorkflowTemplate, WorkflowStep, StepType } from '@services/types';

function saveButtonLabel(isPending: boolean, isEditing: boolean): string {
  if (isPending) return 'Saving...';
  return isEditing ? 'Update' : 'Create';
}

interface WorkflowEditorProps {
  workflow?: WorkflowTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function stepDefaultName(type: StepType, index: number): string {
  if (type === 'review_gate') return 'Review Gate';
  if (type === 'parallel_group') return 'Parallel Group';
  return `Step ${index + 1}`;
}

function createStep(type: StepType, index: number): WorkflowStep {
  const id = `step_${Date.now()}_${index}`;
  return {
    id,
    name: stepDefaultName(type, index),
    type,
    dependsOn: [],
    goal: type === 'agent' ? '' : undefined,
    reviewPrompt: type === 'review_gate' ? '' : undefined,
    parallelStepIds: type === 'parallel_group' ? [] : undefined,
  };
}

export function WorkflowEditor({ workflow, open, onOpenChange }: WorkflowEditorProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  useEffect(() => {
    if (workflow) {
      setName(workflow.name);
      setDescription(workflow.description);
      setSteps(workflow.steps);
    } else {
      setName('');
      setDescription('');
      setSteps([]);
    }
  }, [workflow, open]);

  const createMutation = useMutation(
    trpc.workflow.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['workflow'] });
        onOpenChange(false);
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.workflow.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['workflow'] });
        onOpenChange(false);
      },
    }),
  );

  const addStep = useCallback((type: StepType) => {
    setSteps((prev) => [...prev, createStep(type, prev.length)]);
  }, []);

  const updateStep = useCallback((index: number, step: WorkflowStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }, []);

  const deleteStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = () => {
    if (!workspaceId || !name.trim()) return;
    const data = {
      name: name.trim(),
      description: description.trim(),
      steps,
    };

    if (workflow) {
      updateMutation.mutate({ workspaceId, id: workflow.id, updates: data });
    } else {
      createMutation.mutate({ workspaceId, template: data });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{workflow ? 'Edit Workflow' : 'New Workflow'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                placeholder="Code Review Pipeline"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-desc">Description</Label>
              <Textarea
                id="wf-desc"
                placeholder="Reviews, tests, and merges code changes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Steps ({steps.length})</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Step
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => addStep('agent')}>Agent Step</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addStep('review_gate')}>Review Gate</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addStep('parallel_group')}>Parallel Group</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <WorkflowStepItem
                    key={step.id}
                    step={step}
                    index={i}
                    onChange={(s) => updateStep(i, s)}
                    onDelete={() => deleteStep(i)}
                  />
                ))}
                {steps.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No steps yet. Add steps to define your workflow.
                  </p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || !workspaceId || isPending}>
            {saveButtonLabel(isPending, !!workflow)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

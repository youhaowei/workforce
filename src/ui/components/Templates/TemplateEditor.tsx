/**
 * TemplateEditor - Full editor dialog for creating/editing agent templates.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AgentTemplate } from '@/services/types';

interface TemplateEditorProps {
  template?: AgentTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ReasoningIntensity = 'low' | 'medium' | 'high' | 'max';
const INTENSITIES: ReasoningIntensity[] = ['low', 'medium', 'high', 'max'];

function saveButtonLabel(isPending: boolean, isEditing: boolean): string {
  if (isPending) return 'Saving...';
  return isEditing ? 'Update' : 'Create';
}

export function TemplateEditor({ template, open, onOpenChange }: TemplateEditorProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [skillsInput, setSkillsInput] = useState('');
  const [toolsInput, setToolsInput] = useState('');
  const [constraintsInput, setConstraintsInput] = useState('');
  const [reasoning, setReasoning] = useState<ReasoningIntensity>('medium');

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description);
      setSystemPrompt(template.systemPrompt);
      setSkillsInput(template.skills.join(', '));
      setToolsInput(template.tools.join(', '));
      setConstraintsInput(template.constraints.join('\n'));
      setReasoning(template.reasoningIntensity);
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('');
      setSkillsInput('');
      setToolsInput('');
      setConstraintsInput('');
      setReasoning('medium');
    }
  }, [template, open]);

  const createMutation = useMutation(
    trpc.template.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['template'] });
        onOpenChange(false);
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.template.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['template'] });
        onOpenChange(false);
      },
    }),
  );

  const parseList = (input: string): string[] =>
    input.split(',').map((s) => s.trim()).filter(Boolean);

  const handleSave = () => {
    if (!name.trim()) return;

    const data = {
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      skills: parseList(skillsInput),
      tools: parseList(toolsInput),
      constraints: constraintsInput.split('\n').map((s) => s.trim()).filter(Boolean),
      reasoningIntensity: reasoning,
    };

    if (template) {
      updateMutation.mutate({ orgId, id: template.id, updates: data });
    } else {
      createMutation.mutate({ orgId, template: data });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit Template' : 'New Template'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                placeholder="Code Reviewer"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input
                id="tpl-desc"
                placeholder="Reviews code for quality and correctness"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-prompt">System Prompt</Label>
              <Textarea
                id="tpl-prompt"
                placeholder="You are an expert code reviewer..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Reasoning Intensity</Label>
              <div className="flex gap-2">
                {INTENSITIES.map((level) => (
                  <Badge
                    key={level}
                    variant={reasoning === level ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setReasoning(level)}
                  >
                    {level}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-skills">Skills (comma-separated)</Label>
              <Input
                id="tpl-skills"
                placeholder="code-review, testing"
                value={skillsInput}
                onChange={(e) => setSkillsInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-tools">Tools (comma-separated)</Label>
              <Input
                id="tpl-tools"
                placeholder="Read, Write, Bash, Grep"
                value={toolsInput}
                onChange={(e) => setToolsInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-constraints">Constraints (one per line)</Label>
              <Textarea
                id="tpl-constraints"
                placeholder="Do not modify test files&#10;Always run lint before committing"
                value={constraintsInput}
                onChange={(e) => setConstraintsInput(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || isPending}>
            {saveButtonLabel(isPending, !!template)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * TemplateListView - Main "Templates" tab showing a grid of agent template cards.
 * Uses tRPC queries for CRUD, shadcn components for layout.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { useWorkspaceStore } from '@ui/stores/useWorkspaceStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Search, Blocks } from 'lucide-react';
import { TemplateCard } from './TemplateCard';
import { TemplateEditor } from './TemplateEditor';
import { LaunchFromTemplateDialog } from './LaunchFromTemplateDialog';
import type { AgentTemplate } from '@services/types';

export function TemplateListView() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [keyword, setKeyword] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AgentTemplate | null>(null);
  const [launchTemplate, setLaunchTemplate] = useState<AgentTemplate | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);

  const { data: templates = [], isLoading } = useQuery(
    trpc.template.list.queryOptions(
      { workspaceId: workspaceId! },
      { enabled: !!workspaceId },
    ),
  );

  const duplicateMutation = useMutation(
    trpc.template.duplicate.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['template'] }),
    }),
  );

  const archiveMutation = useMutation(
    trpc.template.archive.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['template'] }),
    }),
  );

  const filtered = keyword
    ? templates.filter((t: AgentTemplate) =>
        t.name.toLowerCase().includes(keyword.toLowerCase()) ||
        t.description.toLowerCase().includes(keyword.toLowerCase()),
      )
    : templates;

  const handleEdit = useCallback((t: AgentTemplate) => {
    setEditingTemplate(t);
    setEditorOpen(true);
  }, []);

  const handleNew = useCallback(() => {
    setEditingTemplate(null);
    setEditorOpen(true);
  }, []);

  const handleLaunch = useCallback((t: AgentTemplate) => {
    setLaunchTemplate(t);
    setLaunchOpen(true);
  }, []);

  const handleDuplicate = useCallback((t: AgentTemplate) => {
    if (!workspaceId) return;
    duplicateMutation.mutate({ workspaceId, id: t.id });
  }, [workspaceId, duplicateMutation]);

  const handleArchive = useCallback((t: AgentTemplate) => {
    if (!workspaceId) return;
    archiveMutation.mutate({ workspaceId, id: t.id });
  }, [workspaceId, archiveMutation]);

  if (!workspaceId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 p-6">
        <Blocks className="h-8 w-8" />
        <p className="text-sm">Select a workspace to manage templates</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Agent Templates</h2>
          <p className="text-xs text-muted-foreground">
            {filtered.length} template{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Template
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isLoading && (
          <p className="text-sm text-muted-foreground text-center py-12">Loading...</p>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {(filtered as AgentTemplate[]).map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onLaunch={handleLaunch}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onArchive={handleArchive}
              />
            ))}
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <Blocks className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">
              {keyword ? 'No matching templates' : 'No templates yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {keyword ? 'Try a different search' : 'Create your first agent template to get started'}
            </p>
            {!keyword && (
              <Button variant="outline" className="mt-4" onClick={handleNew}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Template
              </Button>
            )}
          </div>
        )}
      </ScrollArea>

      <TemplateEditor
        template={editingTemplate}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />
      <LaunchFromTemplateDialog
        template={launchTemplate}
        open={launchOpen}
        onOpenChange={setLaunchOpen}
      />
    </div>
  );
}

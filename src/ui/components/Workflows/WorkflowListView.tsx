/**
 * WorkflowListView - Main "Workflows" tab showing a grid of workflow cards.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Search, Workflow } from "lucide-react";
import { WorkflowCard } from "./WorkflowCard";
import { WorkflowEditor } from "./WorkflowEditor";
import type { WorkflowTemplate } from "@/services/types";

export function WorkflowListView() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();
  const [keyword, setKeyword] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowTemplate | null>(null);

  const { data: workflows = [], isLoading } = useQuery(trpc.workflow.list.queryOptions({ orgId }));

  const executeMutation = useMutation(
    trpc.workflow.execute.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] }),
    }),
  );

  const archiveMutation = useMutation(
    trpc.workflow.archive.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow"] }),
    }),
  );

  const filtered = keyword
    ? workflows.filter(
        (w: WorkflowTemplate) =>
          w.name.toLowerCase().includes(keyword.toLowerCase()) ||
          w.description.toLowerCase().includes(keyword.toLowerCase()),
      )
    : workflows;

  const handleEdit = useCallback((w: WorkflowTemplate) => {
    setEditingWorkflow(w);
    setEditorOpen(true);
  }, []);

  const handleNew = useCallback(() => {
    setEditingWorkflow(null);
    setEditorOpen(true);
  }, []);

  const handleExecute = useCallback(
    (w: WorkflowTemplate) => {
      executeMutation.mutate({ orgId, id: w.id });
    },
    [orgId, executeMutation],
  );

  const handleArchive = useCallback(
    (w: WorkflowTemplate) => {
      archiveMutation.mutate({ orgId, id: w.id });
    },
    [orgId, archiveMutation],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden pt-14 px-6 pb-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workflow Templates</h2>
          <p className="text-xs text-neutral-fg-subtle">
            {filtered.length} workflow{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-fg-subtle" />
            <Input
              placeholder="Search workflows..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Workflow
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isLoading && (
          <p className="text-sm text-neutral-fg-subtle text-center py-12">Loading...</p>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {(filtered as WorkflowTemplate[]).map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onExecute={handleExecute}
                onEdit={handleEdit}
                onArchive={handleArchive}
              />
            ))}
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <Workflow className="h-8 w-8 mx-auto mb-3 text-neutral-fg-subtle" />
            <p className="text-sm font-medium">
              {keyword ? "No matching workflows" : "No workflows yet"}
            </p>
            <p className="text-xs text-neutral-fg-subtle mt-1">
              {keyword ? "Try a different search" : "Define multi-step agent workflows"}
            </p>
            {!keyword && (
              <Button variant="outline" className="mt-4" onClick={handleNew}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Workflow
              </Button>
            )}
          </div>
        )}
      </ScrollArea>

      <WorkflowEditor workflow={editingWorkflow} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}

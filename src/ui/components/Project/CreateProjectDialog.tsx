/**
 * CreateProjectDialog — Dialog wrapper for creating a new project.
 * Uses the shared ProjectForm for the form fields.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectForm } from './ProjectForm';
import type { ProjectFormValues } from './ProjectForm';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (projectId: string) => void;
}

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();
  const listInput = { orgId };

  const createMutation = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: (project) => {
        // Optimistic insert so the panel list updates immediately (before background refetch)
        queryClient.setQueriesData<import('@/services/types').Project[]>(
          { queryKey: trpc.project.list.queryKey(listInput) },
          (old) => old ? [project, ...old] : [project],
        );
        onCreated?.(project.id);
        void queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey(listInput) });
        onOpenChange(false);
      },
    }),
  );

  const handleSubmit = (values: ProjectFormValues) => {
    createMutation.mutate({
      orgId,
      name: values.name,
      rootPath: values.rootPath,
      color: values.color,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <ProjectForm
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          isPending={createMutation.isPending}
          submitLabel="Create"
          pendingLabel="Creating..."
        />
      </DialogContent>
    </Dialog>
  );
}

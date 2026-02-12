/**
 * CreateOrgDialog - Dialog for creating a new organization.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrgDialog({ open, onOpenChange }: CreateOrgDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');

  const createMutation = useMutation(
    trpc.org.create.mutationOptions({
      onSuccess: (org) => {
        setCurrentOrgId(org.id);
        queryClient.invalidateQueries({ queryKey: ['org'] });
        onOpenChange(false);
        setName('');
        setRootPath('');
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rootPath.trim()) return;
    createMutation.mutate({ name: name.trim(), rootPath: rootPath.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Organization</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              placeholder="My Project"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-path">Root Path</Label>
            <Input
              id="org-path"
              placeholder="/path/to/project"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Absolute path to the project directory
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !rootPath.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

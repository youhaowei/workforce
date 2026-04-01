/**
 * CreateOrgDialog - Dialog for creating a new organization.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { useOrgStore } from "@/ui/stores/useOrgStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrgDialog({ open, onOpenChange }: CreateOrgDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);
  const [name, setName] = useState("");

  const createMutation = useMutation(
    trpc.org.create.mutationOptions({
      onSuccess: async (org) => {
        // Mark initialized immediately — orgs created from the management view
        // should skip the SetupGate's InitOrgStep wizard.
        try {
          await trpcClient.org.update.mutate({ id: org.id, updates: { initialized: true } });
        } catch (err) {
          console.warn("[CreateOrgDialog] Failed to mark org as initialized:", err);
        }
        // Persist selection on server so it survives restart
        try {
          await trpcClient.org.activate.mutate({ id: org.id });
        } catch (err) {
          console.warn("[CreateOrgDialog] Failed to activate org on server:", err);
        }
        setCurrentOrgId(org.id);
        queryClient.invalidateQueries({ queryKey: ["org"] });
        setName("");
        onOpenChange(false);
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim() });
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
              placeholder="My Organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

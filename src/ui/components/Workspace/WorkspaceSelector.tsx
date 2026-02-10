/**
 * WorkspaceSelector - Dropdown for switching between workspaces.
 * Shows current workspace name with a dropdown to switch or create new ones.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { useWorkspaceStore } from '@ui/stores/useWorkspaceStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Plus, Settings } from 'lucide-react';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { WorkspaceSettings } from './WorkspaceSettings';
import type { Workspace } from '@services/types';

export function WorkspaceSelector() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: workspaces = [] } = useQuery(
    trpc.workspace.list.queryOptions(),
  );

  const { data: currentWorkspace } = useQuery(
    trpc.workspace.getCurrent.queryOptions(),
  );

  const activateMutation = useMutation(
    trpc.workspace.activate.mutationOptions({
      onSuccess: (ws) => {
        setCurrentWorkspaceId(ws.id);
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
      },
    }),
  );

  const handleSelect = (ws: Workspace) => {
    activateMutation.mutate({ id: ws.id });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors">
            <Badge variant="outline" className="text-xs font-normal">
              {currentWorkspace?.name ?? 'No workspace'}
            </Badge>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {workspaces.map((ws: Workspace) => (
            <DropdownMenuItem
              key={ws.id}
              onClick={() => handleSelect(ws)}
              className={ws.id === workspaceId ? 'bg-accent' : ''}
            >
              <span className="flex-1 truncate">{ws.name}</span>
              {ws.id === workspaceId && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-2">active</Badge>
              )}
            </DropdownMenuItem>
          ))}
          {workspaces.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-2" />
            New Workspace
          </DropdownMenuItem>
          {currentWorkspace && (
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="h-3.5 w-3.5 mr-2" />
              Settings
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      {currentWorkspace && (
        <WorkspaceSettings
          workspace={currentWorkspace}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useWorkspaceStore } from '@/ui/stores/useWorkspaceStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Plus, Settings, FolderOpen, Check } from 'lucide-react';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { WorkspaceSettings } from './WorkspaceSettings';
import type { Workspace } from '@/services/types';

export function WorkspacesListView() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsWorkspace, setSettingsWorkspace] = useState<Workspace | null>(null);

  const { data: workspaces = [] } = useQuery(
    trpc.workspace.list.queryOptions(),
  );

  const activateMutation = useMutation(
    trpc.workspace.activate.mutationOptions({
      onSuccess: (ws) => {
        setCurrentWorkspaceId(ws.id);
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
      },
    }),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workspaces</h2>
          <p className="text-xs text-muted-foreground">
            Manage your project workspaces
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Workspace
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No workspaces yet</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create your first workspace
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
          {(workspaces as Workspace[]).map((ws) => {
            const isActive = ws.id === workspaceId;
            return (
              <Card
                key={ws.id}
                className={`cursor-pointer transition-colors hover:border-primary/50 ${
                  isActive ? 'border-primary ring-1 ring-primary/20' : ''
                }`}
                onClick={() => activateMutation.mutate({ id: ws.id })}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{ws.name}</CardTitle>
                    <div className="flex items-center gap-1">
                      {isActive && (
                        <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                          <Check className="h-2.5 w-2.5" />
                          Active
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsWorkspace(ws);
                        }}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {ws.description && (
                    <CardDescription className="text-xs">{ws.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {ws.rootPath}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      {settingsWorkspace && (
        <WorkspaceSettings
          workspace={settingsWorkspace}
          open={!!settingsWorkspace}
          onOpenChange={(open) => { if (!open) setSettingsWorkspace(null); }}
        />
      )}
    </div>
  );
}

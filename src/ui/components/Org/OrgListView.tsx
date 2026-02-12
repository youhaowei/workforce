import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Plus, Settings, FolderOpen, Check } from 'lucide-react';
import { CreateOrgDialog } from './CreateOrgDialog';
import { OrgSettings } from './OrgSettings';
import type { Org } from '@/services/types';

export function OrgListView() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useOrgStore((s) => s.currentOrgId);
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOrg, setSettingsOrg] = useState<Org | null>(null);

  const { data: orgs = [] } = useQuery(
    trpc.org.list.queryOptions(),
  );

  const activateMutation = useMutation(
    trpc.org.activate.mutationOptions({
      onSuccess: (org) => {
        setCurrentOrgId(org.id);
        queryClient.invalidateQueries({ queryKey: ['org'] });
      },
    }),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden pt-14 px-6 pb-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Organizations</h2>
          <p className="text-xs text-muted-foreground">
            Manage your organizations
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Org
        </Button>
      </div>

      {orgs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No organizations yet</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create your first org
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
          {(orgs as Org[]).map((org) => {
            const isActive = org.id === orgId;
            return (
              <Card
                key={org.id}
                className={`cursor-pointer transition-colors hover:border-primary/50 ${
                  isActive ? 'border-primary ring-1 ring-primary/20' : ''
                }`}
                onClick={() => activateMutation.mutate({ id: org.id })}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{org.name}</CardTitle>
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
                          setSettingsOrg(org);
                        }}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {org.description && (
                    <CardDescription className="text-xs">{org.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {org.rootPath}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
      {settingsOrg && (
        <OrgSettings
          org={settingsOrg}
          open={!!settingsOrg}
          onOpenChange={(open) => { if (!open) setSettingsOrg(null); }}
        />
      )}
    </div>
  );
}

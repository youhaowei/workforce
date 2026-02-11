/**
 * AgentOverview - Overview tab showing state history, children, and worktree info.
 */

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, GitBranch } from 'lucide-react';
import { stateVariant } from '@/ui/lib/stateVariant';
import { WorktreePanel } from '../Worktree';
import type { Session, SessionLifecycle } from '@/services/types';

interface AgentOverviewProps {
  session: Session;
  onChildClick?: (childSessionId: string) => void;
}

export function AgentOverview({ session, onChildClick }: AgentOverviewProps) {
  const trpc = useTRPC();
  const workspaceId = session.metadata?.workspaceId as string | undefined;

  const { data: children = [] } = useQuery(
    trpc.session.children.queryOptions(
      { sessionId: session.id },
      { enabled: !!session.id },
    ),
  );

  const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
  const worktreePath = session.metadata?.worktreePath as string | undefined;
  const templateId = session.metadata?.templateId as string | undefined;
  const workflowId = (session.metadata as Record<string, unknown>)?.workflowId as string | undefined;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 max-w-2xl pb-4">
        {/* Session Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Session ID</span>
            <p className="font-mono text-xs mt-0.5">{session.id}</p>
          </div>
          {templateId && (
            <div>
              <span className="text-muted-foreground text-xs">Template</span>
              <p className="text-xs mt-0.5">{templateId}</p>
            </div>
          )}
          {workspaceId && (
            <div>
              <span className="text-muted-foreground text-xs">Workspace</span>
              <p className="text-xs mt-0.5">{workspaceId}</p>
            </div>
          )}
          {workflowId && (
            <div>
              <span className="text-muted-foreground text-xs">Workflow</span>
              <p className="text-xs mt-0.5">{workflowId}</p>
            </div>
          )}
        </div>

        {/* State History */}
        <div>
          <h3 className="text-sm font-medium mb-2">State History</h3>
          <div className="space-y-1">
            {(lifecycle?.stateHistory ?? []).map((transition, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="font-mono text-muted-foreground w-20 shrink-0">
                  {new Date(transition.timestamp).toLocaleTimeString()}
                </span>
                <Badge variant={stateVariant(transition.from)} className="text-[10px] h-5">
                  {transition.from}
                </Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <Badge variant={stateVariant(transition.to)} className="text-[10px] h-5">
                  {transition.to}
                </Badge>
                <span className="text-muted-foreground truncate">{transition.reason}</span>
              </div>
            ))}
            {(lifecycle?.stateHistory ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No state transitions</p>
            )}
          </div>
        </div>

        {/* Worktree */}
        {worktreePath && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Worktree
            </h3>
            <WorktreePanel sessionId={session.id} />
          </div>
        )}

        {/* Children */}
        {children.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">Child Agents ({children.length})</h3>
            <div className="space-y-2">
              {(children as Session[]).map((child) => {
                const childLifecycle = child.metadata?.lifecycle as SessionLifecycle | undefined;
                const childState = childLifecycle?.state ?? 'created';
                const childGoal = (child.metadata?.goal as string) ?? child.id;
                return (
                  <Card
                    key={child.id}
                    className="cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => onChildClick?.(child.id)}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <Badge variant={stateVariant(childState)} className="text-[10px] shrink-0">
                        {childState}
                      </Badge>
                      <span className="text-sm flex-1 truncate">{childGoal}</span>
                      <code className="text-[10px] text-muted-foreground">{child.id.slice(0, 8)}</code>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

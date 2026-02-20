/**
 * HomeView - Default landing page with overview stats and quick actions.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';

import { useOrgStore } from '@/ui/stores/useOrgStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  AlertCircle,
  Plus,
  ArrowRight,
} from 'lucide-react';
import type { SessionLifecycle } from '@/services/types';
import type { ViewType } from '../Shell/Shell';

interface HomeViewProps {
  onStartChat: () => void;
  onNavigate: (view: ViewType) => void;
  onSelectSession?: (sessionId: string) => void;
}

export function HomeView({ onStartChat, onNavigate, onSelectSession }: HomeViewProps) {
  const trpc = useTRPC();
  const orgId = useOrgStore((s) => s.currentOrgId)!;

  const { data: sessions = [] } = useQuery(
    trpc.session.list.queryOptions(
      { orgId },
      { refetchInterval: 5000 },
    ),
  );

  const { data: pendingReviews = 0 } = useQuery(
    trpc.review.count.queryOptions({ orgId }),
  );

  const { data: user } = useQuery(
    trpc.user.get.queryOptions(undefined, { staleTime: 5 * 60_000 }),
  );

  const stats = useMemo(() => {
    const agents = sessions.filter(
      (s) => s.metadata?.type === 'workagent',
    );
    const activeAgents = agents.filter((s) => {
      const lifecycle = s.metadata?.lifecycle as SessionLifecycle | undefined;
      return lifecycle?.state === 'active';
    });
    return {
      totalSessions: sessions.length,
      activeAgents: activeAgents.length,
      pendingReviews: pendingReviews as number,
    };
  }, [sessions, pendingReviews]);

  const recentSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5);
  }, [sessions]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden pt-14 px-6 pb-6">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {user?.displayName ? `Welcome back, ${user.displayName}` : 'Welcome to Workforce'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your agent orchestration dashboard
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Active Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.activeAgents}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Pending Reviews
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.pendingReviews}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Total Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalSessions}</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 mb-6">
        <Button onClick={onStartChat}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Chat
        </Button>
        <Button variant="outline" onClick={() => onNavigate('board')}>
          <LayoutDashboard className="h-4 w-4 mr-1.5" />
          View Board
        </Button>
      </div>

      {/* Recent Sessions */}
      {recentSessions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent Sessions</h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => onNavigate('sessions')}
            >
              View all
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
          <div className="space-y-1">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession?.(session.id)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 transition-colors flex items-center justify-between group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {session.title || (session.metadata?.goal as string) || 'Untitled Session'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {session.messageCount} messages
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

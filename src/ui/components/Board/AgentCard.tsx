/**
 * AgentCard - A card representing a single WorkAgent session on the Board.
 * Shows goal, state badge, progress indicator, child count, and quick actions.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pause, Play, XCircle, Users } from 'lucide-react';
import { stateVariant } from '@ui/lib/stateVariant';
import type { Session, SessionLifecycle } from '@services/types';

export interface AgentCardProps {
  session: Session;
  onClick?: (sessionId: string) => void;
  onAction?: (sessionId: string, action: 'pause' | 'resume' | 'cancel') => void;
}

export function AgentCard({ session, onClick, onAction }: AgentCardProps) {
  const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
  const state = lifecycle?.state ?? 'created';
  const goal = (session.metadata?.goal as string) ?? 'No goal set';
  const templateId = session.metadata?.templateId as string | undefined;
  const childCount = (session.metadata?.childCount as number) ?? 0;
  const progress = (session.metadata?.progress as number) ?? undefined;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onClick?.(session.id)}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-sm font-medium line-clamp-2 flex-1">{goal}</span>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={stateVariant(state)} className="text-[10px] uppercase">
              {state}
            </Badge>
            {onAction && (state === 'active' || state === 'paused') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {state === 'active' && (
                    <DropdownMenuItem onClick={() => onAction(session.id, 'pause')}>
                      <Pause className="h-3 w-3 mr-2" />
                      Pause
                    </DropdownMenuItem>
                  )}
                  {state === 'paused' && (
                    <DropdownMenuItem onClick={() => onAction(session.id, 'resume')}>
                      <Play className="h-3 w-3 mr-2" />
                      Resume
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => onAction(session.id, 'cancel')}
                    className="text-destructive"
                  >
                    <XCircle className="h-3 w-3 mr-2" />
                    Cancel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Progress bar for active agents */}
        {state === 'active' && progress !== undefined && (
          <Progress value={progress} className="h-1 mb-2" />
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
            {session.id.slice(0, 12)}
          </code>
          {templateId && (
            <span className="truncate">{templateId}</span>
          )}
          {childCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
              <Users className="h-2.5 w-2.5" />
              {childCount}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

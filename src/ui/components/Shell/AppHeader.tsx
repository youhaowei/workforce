import {
  LayoutDashboard,
  MessageSquare,
  ClipboardList,
  Blocks,
  Workflow,
  History,
  PanelLeftOpen,
  ListTodo,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { ReviewBadge } from '../Review';
import { WorkspaceSelector } from '../Workspace';
import type { ViewType } from './Shell';

interface AppHeaderProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  sessionsPanelOpen: boolean;
  onToggleSessions: () => void;
  todoPanelOpen: boolean;
  onToggleTodo: () => void;
}

export default function AppHeader({
  currentView,
  onViewChange,
  sessionsPanelOpen,
  onToggleSessions,
  todoPanelOpen,
  onToggleTodo,
}: AppHeaderProps) {
  const tabValue = currentView === 'detail' ? 'board' : currentView;

  return (
    <header className="flex-shrink-0 border-b bg-background/95 backdrop-blur-sm">
      <div className="px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              W
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none">Workforce</h1>
              <p className="text-xs text-muted-foreground">Orchestrator</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <Tabs value={tabValue} onValueChange={(v) => onViewChange(v as ViewType)}>
            <TabsList>
              <TabsTrigger value="board" className="gap-1.5">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Board
              </TabsTrigger>
              <TabsTrigger value="queue" className="gap-1.5 relative">
                <ClipboardList className="h-3.5 w-3.5" />
                Queue
                <ReviewBadge />
              </TabsTrigger>
              <TabsTrigger value="chat" className="gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="templates" className="gap-1.5">
                <Blocks className="h-3.5 w-3.5" />
                Templates
              </TabsTrigger>
              <TabsTrigger value="workflows" className="gap-1.5">
                <Workflow className="h-3.5 w-3.5" />
                Workflows
              </TabsTrigger>
              <TabsTrigger value="audit" className="gap-1.5">
                <History className="h-3.5 w-3.5" />
                Audit
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={sessionsPanelOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggleSessions}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sessions (Cmd+Shift+H)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={todoPanelOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggleTodo}
                >
                  <ListTodo className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tasks (Cmd+Shift+T)</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-5 mx-1" />

            <WorkspaceSelector />
          </div>
        </div>
      </div>
    </header>
  );
}

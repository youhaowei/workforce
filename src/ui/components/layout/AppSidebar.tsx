import React from 'react';
import type { MainTab } from '@ui/stores/appStore';
import { APP_TABS } from '@ui/constants/navigation';
import { Button, Separator } from '@ui/components/ui';
import { cn } from '@ui/lib/utils';

interface AppSidebarProps {
  currentTab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

export default function AppSidebar(props: AppSidebarProps): React.ReactElement {
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col border-r border-zinc-200 bg-white p-4">
      <div className="mb-4 pb-3">
        <h1 className="text-xl font-semibold text-zinc-900">Workforce</h1>
        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Agentic Orchestrator</p>
      </div>
      <Separator />

      <div className="mb-2 mt-4 px-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500">Views</div>
      <nav className="flex flex-1 flex-col gap-1 overflow-auto">
        {APP_TABS.map((tab) => (
          <Button
            key={tab.id}
            className={cn(
              'justify-start',
              props.currentTab === tab.id
                ? 'bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90'
                : 'text-zinc-700'
            )}
            variant={props.currentTab === tab.id ? 'default' : 'ghost'}
            onClick={() => props.onTabChange(tab.id)}
            type="button"
          >
            {tab.label}
          </Button>
        ))}
      </nav>
    </aside>
  );
}

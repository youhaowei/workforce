import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/ui/lib/utils';
import type { AgentModelInfo, AgentPermissionMode, ThinkingLevel } from '@/services/types';
import { THINKING_LEVELS, PERMISSION_OPTIONS } from './agentConfig';

interface PillProps {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function Pill({ label, disabled, children }: PillProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs border bg-muted/50',
          'hover:bg-muted transition-colors outline-none',
          'focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        {label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-[160px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AgentConfigToolbarProps {
  model: string;
  thinkingLevel: ThinkingLevel;
  permissionMode: AgentPermissionMode;
  models: AgentModelInfo[];
  onModelChange: (value: string) => void;
  onThinkingChange: (value: ThinkingLevel) => void;
  onPermissionChange: (value: AgentPermissionMode) => void;
  disabled?: boolean;
}

export default function AgentConfigToolbar({
  model,
  thinkingLevel,
  permissionMode,
  models,
  onModelChange,
  onThinkingChange,
  onPermissionChange,
  disabled,
}: AgentConfigToolbarProps) {
  const modelLabel = models.find((m) => m.id === model)?.displayName ?? model.replace(/^claude-/, '');
  const thinkingLabel = THINKING_LEVELS.find((l) => l.value === thinkingLevel)?.label ?? thinkingLevel;
  const permissionLabel = PERMISSION_OPTIONS.find((p) => p.value === permissionMode)?.label ?? permissionMode;

  return (
    <div className="flex items-center gap-1.5">
      <Pill label={modelLabel} disabled={disabled}>
        <DropdownMenuLabel className="text-xs">Model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={model} onValueChange={onModelChange}>
          {models.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id} className="text-xs flex-col items-start gap-0">
              <span>{m.displayName}</span>
              {m.description && <span className="text-muted-foreground font-normal">{m.description}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </Pill>

      <Pill label={thinkingLabel} disabled={disabled}>
        <DropdownMenuLabel className="text-xs">Thinking</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={thinkingLevel}
          onValueChange={(value) => onThinkingChange(value as ThinkingLevel)}
        >
          {THINKING_LEVELS.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value} className="text-xs">
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </Pill>

      <Pill label={permissionLabel} disabled={disabled}>
        <DropdownMenuLabel className="text-xs">Permission</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={permissionMode}
          onValueChange={(value) => onPermissionChange(value as AgentPermissionMode)}
        >
          {PERMISSION_OPTIONS.map((p) => (
            <DropdownMenuRadioItem key={p.value} value={p.value} className="text-xs">
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </Pill>
    </div>
  );
}

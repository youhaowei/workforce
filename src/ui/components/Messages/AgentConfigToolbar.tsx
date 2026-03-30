import { ChevronDown, ShieldQuestion, FileEdit, ShieldOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
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

const PERMISSION_ICONS: Record<AgentPermissionMode, typeof ShieldQuestion> = {
  default: ShieldQuestion,
  acceptEdits: FileEdit,
  bypassPermissions: ShieldOff,
};

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
          'inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[11px]',
          'text-neutral-fg-subtle/70 hover:text-neutral-fg-subtle transition-colors outline-none',
          'focus-visible:ring-1 focus-visible:ring-neutral-ring',
          'disabled:opacity-30 disabled:cursor-not-allowed',
        )}
      >
        {label}
        <ChevronDown className="h-2.5 w-2.5 opacity-40" />
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
  planMode: boolean;
  models: AgentModelInfo[];
  onModelChange: (value: string) => void;
  onThinkingChange: (value: ThinkingLevel) => void;
  onPermissionChange: (value: AgentPermissionMode) => void;
  onPlanModeChange: (value: boolean) => void;
  disabled?: boolean;
}

export default function AgentConfigToolbar({
  model,
  thinkingLevel,
  permissionMode,
  planMode,
  models,
  onModelChange,
  onThinkingChange,
  onPermissionChange,
  onPlanModeChange,
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
              {m.description && <span className="text-neutral-fg-subtle font-normal">{m.description}</span>}
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

      {/* Permission mode — Claude Desktop style dropdown with icon + description */}
      <Pill label={permissionLabel} disabled={disabled}>
        <DropdownMenuLabel className="text-xs">Permission</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={permissionMode}
          onValueChange={(value) => onPermissionChange(value as AgentPermissionMode)}
        >
          {PERMISSION_OPTIONS.map((p) => {
            const Icon = PERMISSION_ICONS[p.value];
            return (
              <DropdownMenuRadioItem key={p.value} value={p.value} className="text-xs flex-col items-start gap-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{p.label}</span>
                </div>
                <span className="text-neutral-fg-subtle font-normal text-[10px] ml-[22px]">{p.description}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </Pill>

      {/* Plan mode — toggle switch */}
      <label
        className={cn(
          'inline-flex items-center gap-1.5 text-[11px] cursor-pointer select-none',
          disabled && 'opacity-30 cursor-not-allowed',
          planMode ? 'text-palette-primary' : 'text-neutral-fg-subtle/70',
        )}
      >
        Plan
        <Switch
          checked={planMode}
          onCheckedChange={onPlanModeChange}
          disabled={disabled}
          className="scale-[0.6] origin-left"
        />
      </label>
    </div>
  );
}

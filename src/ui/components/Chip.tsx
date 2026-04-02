/**
 * Chip — small inline label used for tool badges, subagent types, and field headers.
 *
 * Usage:
 *   <Chip>agent-models.ts</Chip>
 *   <Chip color="danger">Error</Chip>
 *   <Chip color="muted">What's wrong</Chip>
 */

import { cn } from "@/ui/lib/utils";

const colorStyles = {
  secondary: "bg-palette-secondary/10 text-palette-secondary",
  danger: "bg-palette-danger/10 text-palette-danger",
  muted: "bg-neutral-bg-dim/50 text-neutral-fg-subtle",
} as const;

interface ChipProps {
  color?: keyof typeof colorStyles;
  className?: string;
  children: React.ReactNode;
}

export function Chip({ color = "secondary", className, children }: ChipProps) {
  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
        colorStyles[color],
        className,
      )}
    >
      {children}
    </span>
  );
}

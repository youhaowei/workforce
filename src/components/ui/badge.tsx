import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/ui/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        solid: "border-transparent text-[var(--badge-fg)] bg-[var(--badge-bg)] hover:opacity-90",
        soft: "border-transparent text-[var(--badge-bg)] bg-[var(--badge-bg)]/10",
        outline: "border text-neutral-fg",
      },
      color: {
        default: "[--badge-bg:var(--neutral-fg-subtle)] [--badge-fg:var(--neutral-bg)]",
        primary: "[--badge-bg:var(--palette-primary)] [--badge-fg:var(--palette-primary-fg)]",
        secondary: "[--badge-bg:var(--palette-secondary)] [--badge-fg:var(--palette-secondary-fg)]",
        success: "[--badge-bg:var(--palette-success)] [--badge-fg:var(--palette-success-fg)]",
        danger: "[--badge-bg:var(--palette-danger)] [--badge-fg:var(--palette-danger-fg)]",
        warning: "[--badge-bg:var(--palette-warning)] [--badge-fg:var(--palette-warning-fg)]",
        info: "[--badge-bg:var(--palette-info)] [--badge-fg:var(--palette-info-fg)]",
      },
    },
    defaultVariants: {
      variant: "solid",
      color: "default",
    },
  },
);

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "color">, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, color, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, color }), className)} {...props} />;
}

export { Badge, badgeVariants };

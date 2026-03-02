import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/ui/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        solid:
          "border-transparent text-[var(--badge-fg)] bg-[var(--badge-bg)] hover:opacity-90",
        soft:
          "border-transparent text-[var(--badge-bg)] bg-[var(--badge-bg)]/10",
        outline: "border text-foreground",
      },
      color: {
        default:
          "[--badge-bg:var(--ds-default)] [--badge-fg:var(--ds-default-foreground)]",
        primary:
          "[--badge-bg:var(--ds-primary)] [--badge-fg:var(--ds-primary-foreground)]",
        secondary:
          "[--badge-bg:var(--ds-secondary)] [--badge-fg:var(--ds-secondary-foreground)]",
        success:
          "[--badge-bg:var(--success)] [--badge-fg:var(--success-foreground)]",
        danger:
          "[--badge-bg:var(--danger)] [--badge-fg:var(--danger-foreground)]",
        warning:
          "[--badge-bg:var(--warning)] [--badge-fg:var(--warning-foreground)]",
        info:
          "[--badge-bg:var(--info)] [--badge-fg:var(--info-foreground)]",
      },
    },
    defaultVariants: {
      variant: "solid",
      color: "default",
    },
  }
)

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, color, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, color }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

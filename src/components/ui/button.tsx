import * as React from "react"
import { Slot as SlotPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/ui/lib/utils"

/**
 * Two-axis button variants using CSS custom properties.
 *
 * The `color` axis sets three properties consumed by `variant` styles:
 * - `--btn-bg`  — base color (solid bg, soft/outline text, outline border)
 * - `--btn-fg`  — foreground on solid variant
 * - `--btn-color` — text color for ghost variant
 *
 * This indirection lets any variant × color combination work without
 * an N×M class matrix. Other components (e.g. AlertDialogAction) can
 * override these properties directly via className to reuse the system.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid: "text-[var(--btn-fg)] bg-[var(--btn-bg)] hover:opacity-90",
        soft: "text-[var(--btn-bg)] bg-[var(--btn-bg)]/10 hover:bg-[var(--btn-bg)]/15",
        outline:
          "text-[var(--btn-bg)] border border-[var(--btn-bg)]/30 hover:bg-[var(--btn-bg)]/5",
        ghost: "text-[var(--btn-color)] hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      color: {
        default:
          "[--btn-bg:var(--ds-default)] [--btn-fg:var(--ds-default-foreground)] [--btn-color:var(--muted-foreground)]",
        primary:
          "[--btn-bg:var(--ds-primary)] [--btn-fg:var(--ds-primary-foreground)] [--btn-color:var(--foreground)]",
        secondary:
          "[--btn-bg:var(--ds-secondary)] [--btn-fg:var(--ds-secondary-foreground)] [--btn-color:var(--muted-foreground)]",
        success:
          "[--btn-bg:var(--success)] [--btn-fg:var(--success-foreground)] [--btn-color:var(--success)]",
        danger:
          "[--btn-bg:var(--danger)] [--btn-fg:var(--danger-foreground)] [--btn-color:var(--danger)]",
        warning:
          "[--btn-bg:var(--warning)] [--btn-fg:var(--warning-foreground)] [--btn-color:var(--warning)]",
        info:
          "[--btn-bg:var(--info)] [--btn-fg:var(--info-foreground)] [--btn-color:var(--info)]",
      },
      size: {
        xs: "h-5 rounded px-1.5 text-[11px] font-medium gap-1 [&_svg]:size-3",
        sm: "h-8 rounded-md px-3 text-[13px]",
        default: "h-9 rounded-md px-4 text-sm",
        lg: "h-11 rounded-md px-8 text-base",
        icon: "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "solid",
      color: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, color, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? SlotPrimitive.Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, color, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

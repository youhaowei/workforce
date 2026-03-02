import * as React from "react"
import { Slot as SlotPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/ui/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 ring-offset-neutral-bg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid: "",
        soft: "",
        outline: "border",
        ghost: "",
        link: "underline-offset-4 hover:underline",
      },
      color: {
        neutral: "",
        primary: "",
        secondary: "",
        success: "",
        danger: "",
        warning: "",
        info: "",
      },
      size: {
        xs: "h-5 rounded px-1.5 text-[11px] font-medium gap-1 [&_svg]:size-3",
        sm: "h-8 rounded-md px-3 text-[13px]",
        default: "h-9 rounded-md px-4 text-sm",
        lg: "h-11 rounded-md px-8 text-base",
        icon: "h-9 w-9 rounded-md",
      },
    },
    compoundVariants: [
      // ── solid ──────────────────────────────────────────────────────────────
      { variant: "solid", color: "neutral", className: "bg-neutral-fg text-neutral-bg hover:bg-neutral-fg/90" },
      { variant: "solid", color: "primary", className: "bg-palette-primary text-palette-primary-fg hover:bg-palette-primary/90" },
      { variant: "solid", color: "secondary", className: "bg-palette-secondary text-palette-secondary-fg hover:bg-palette-secondary/90" },
      { variant: "solid", color: "success", className: "bg-palette-success text-palette-success-fg hover:bg-palette-success/90" },
      { variant: "solid", color: "danger", className: "bg-palette-danger text-palette-danger-fg hover:bg-palette-danger/90" },
      { variant: "solid", color: "warning", className: "bg-palette-warning text-palette-warning-fg hover:bg-palette-warning/90" },
      { variant: "solid", color: "info", className: "bg-palette-info text-palette-info-fg hover:bg-palette-info/90" },

      // ── soft ───────────────────────────────────────────────────────────────
      { variant: "soft", color: "neutral", className: "text-neutral-fg bg-neutral-fg/10 hover:bg-neutral-fg/15" },
      { variant: "soft", color: "primary", className: "text-palette-primary bg-palette-primary/10 hover:bg-palette-primary/15" },
      { variant: "soft", color: "secondary", className: "text-palette-secondary bg-palette-secondary/10 hover:bg-palette-secondary/15" },
      { variant: "soft", color: "success", className: "text-palette-success bg-palette-success/10 hover:bg-palette-success/15" },
      { variant: "soft", color: "danger", className: "text-palette-danger bg-palette-danger/10 hover:bg-palette-danger/15" },
      { variant: "soft", color: "warning", className: "text-palette-warning bg-palette-warning/10 hover:bg-palette-warning/15" },
      { variant: "soft", color: "info", className: "text-palette-info bg-palette-info/10 hover:bg-palette-info/15" },

      // ── outline ────────────────────────────────────────────────────────────
      { variant: "outline", color: "neutral", className: "text-neutral-fg border-neutral-border hover:bg-neutral-bg-subtle" },
      { variant: "outline", color: "primary", className: "text-palette-primary border-palette-primary/30 hover:bg-palette-primary/5" },
      { variant: "outline", color: "secondary", className: "text-palette-secondary border-palette-secondary/30 hover:bg-palette-secondary/5" },
      { variant: "outline", color: "success", className: "text-palette-success border-palette-success/30 hover:bg-palette-success/5" },
      { variant: "outline", color: "danger", className: "text-palette-danger border-palette-danger/30 hover:bg-palette-danger/5" },
      { variant: "outline", color: "warning", className: "text-palette-warning border-palette-warning/30 hover:bg-palette-warning/5" },
      { variant: "outline", color: "info", className: "text-palette-info border-palette-info/30 hover:bg-palette-info/5" },

      // ── ghost ──────────────────────────────────────────────────────────────
      { variant: "ghost", color: "neutral", className: "text-neutral-fg-subtle hover:bg-neutral-bg-subtle hover:text-neutral-fg" },
      { variant: "ghost", color: "primary", className: "text-neutral-fg hover:bg-neutral-bg-subtle hover:text-neutral-fg" },
      { variant: "ghost", color: "secondary", className: "text-neutral-fg-subtle hover:bg-neutral-bg-subtle hover:text-neutral-fg" },
      { variant: "ghost", color: "success", className: "text-palette-success hover:bg-palette-success/10" },
      { variant: "ghost", color: "danger", className: "text-palette-danger hover:bg-palette-danger/10" },
      { variant: "ghost", color: "warning", className: "text-palette-warning hover:bg-palette-warning/10" },
      { variant: "ghost", color: "info", className: "text-palette-info hover:bg-palette-info/10" },

      // ── link ───────────────────────────────────────────────────────────────
      { variant: "link", color: "neutral", className: "text-neutral-fg" },
      { variant: "link", color: "primary", className: "text-palette-primary" },
      { variant: "link", color: "secondary", className: "text-palette-secondary" },
      { variant: "link", color: "success", className: "text-palette-success" },
      { variant: "link", color: "danger", className: "text-palette-danger" },
      { variant: "link", color: "warning", className: "text-palette-warning" },
      { variant: "link", color: "info", className: "text-palette-info" },
    ],
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

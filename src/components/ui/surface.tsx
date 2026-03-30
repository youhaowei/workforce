import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/ui/lib/utils"
import { usePlatform } from "@/ui/context/PlatformProvider"

const surfaceVariants = cva("overflow-hidden", {
  variants: {
    variant: {
      main: "bg-neutral-bg/80",
      stage: "bg-neutral-bg/70",
      panel: "bg-neutral-bg/90 saturate-[1.2]",
    },
  },
})

/** Desktop: use glass variant for vibrancy blur-through. */
const desktopOverrides: Record<
  "main" | "stage" | "panel",
  string
> = {
  main: "!bg-neutral-bg/40 saturate-[1.2]",
  stage: "!bg-neutral-bg/60",
  panel: "!bg-neutral-bg/60",
}

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, ...props }, ref) => {
    const { isDesktop } = usePlatform()
    const desktopClass =
      isDesktop && variant
        ? desktopOverrides[variant]
        : undefined
    return (
      <div
        ref={ref}
        className={cn(
          surfaceVariants({ variant, className }),
          desktopClass,
        )}
        {...props}
      />
    )
  }
)
Surface.displayName = "Surface"

export { Surface, surfaceVariants }

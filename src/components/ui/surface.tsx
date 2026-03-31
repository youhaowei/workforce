import * as React from "react"

import { cn } from "@/ui/lib/utils"
import { usePlatform } from "@/ui/context/PlatformProvider"

// Not using CVA: desktop/web variants are mutually exclusive (selected at
// runtime via usePlatform), so CVA's cascade model required !important overrides.
type SurfaceVariant = "main" | "stage" | "panel"

const baseClasses = "overflow-hidden"

const webVariants: Record<SurfaceVariant, string> = {
  main: "bg-neutral-bg/80",
  stage: "bg-neutral-bg/70",
  panel: "bg-neutral-bg/90 saturate-[1.2]",
}

const desktopVariants: Record<SurfaceVariant, string> = {
  main: "bg-neutral-bg/40 saturate-[1.2]",
  stage: "bg-neutral-bg/60",
  panel: "bg-neutral-bg/60",
}

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant | null
}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, ...props }, ref) => {
    const { isDesktop } = usePlatform()
    const variantClass = variant
      ? (isDesktop ? desktopVariants : webVariants)[variant]
      : undefined
    return (
      <div
        ref={ref}
        className={cn(baseClasses, variantClass, className)}
        {...props}
      />
    )
  }
)
Surface.displayName = "Surface"

export { Surface }

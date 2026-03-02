import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/ui/lib/utils"

const surfaceVariants = cva("overflow-hidden", {
  variants: {
    variant: {
      main: "bg-neutral-bg/45 backdrop-blur-[40px] saturate-[1.6]",
      stage: "bg-neutral-bg/95",
      panel: "bg-neutral-bg/90 backdrop-blur-[24px] saturate-[1.4]",
    },
  },
})

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(surfaceVariants({ variant, className }))}
      {...props}
    />
  )
)
Surface.displayName = "Surface"

export { Surface, surfaceVariants }

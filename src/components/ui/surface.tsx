import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/ui/lib/utils";
import { usePlatform } from "@/ui/context/PlatformProvider";

const surfaceVariants = cva("overflow-hidden", {
  variants: {
    variant: {
      main: "bg-neutral-bg/45 saturate-[1.2]",
      stage: "bg-neutral-bg/95",
      panel: "bg-neutral-bg/90 saturate-[1.2]",
    },
  },
});

/** Desktop: main fully transparent (macOS vibrancy shows through), stage/panel opaque for readability */
const desktopOverrides: Record<"main" | "stage" | "panel", string> = {
  main: "!bg-neutral-bg/40",
  stage: "!bg-neutral-bg/80",
  panel: "!bg-neutral-bg/60",
};

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceVariants> {}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, ...props }, ref) => {
    const { isDesktop } = usePlatform();
    const desktopClass = isDesktop && variant ? desktopOverrides[variant] : undefined;
    return (
      <div
        ref={ref}
        className={cn(surfaceVariants({ variant, className }), desktopClass)}
        {...props}
      />
    );
  },
);
Surface.displayName = "Surface";

export { Surface, surfaceVariants };

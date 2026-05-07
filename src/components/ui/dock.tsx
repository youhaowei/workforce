import * as React from "react";

import { cn } from "@/ui/lib/utils";

export interface DockProps extends React.HTMLAttributes<HTMLDivElement> {
  side: "left" | "right" | "bottom";
  open: boolean;
  width?: number;
  height?: number;
}

const borderSide: Record<DockProps["side"], string> = {
  left: "border-r border-neutral-border/30",
  right: "border-l border-neutral-border/30",
  bottom: "border-t border-neutral-border/30",
};

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  ({ side, open, width, height, className, children, ...props }, ref) => {
    const isHorizontal = side === "left" || side === "right";
    const collapseStyle = isHorizontal
      ? { width: open ? (width ?? "auto") : 0 }
      : { height: open ? (height ?? "auto") : 0 };

    return (
      <div
        ref={ref}
        className={cn(
          "shrink-0 overflow-hidden",
          "transition-[width,height] duration-200 ease-in-out motion-reduce:transition-none",
          open && borderSide[side],
          className,
        )}
        style={collapseStyle}
        aria-hidden={!open}
        inert={!open ? true : undefined}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Dock.displayName = "Dock";

export { Dock };

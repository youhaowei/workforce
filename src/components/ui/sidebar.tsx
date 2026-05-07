import * as React from "react";

import { cn } from "@/ui/lib/utils";
import { Surface } from "./surface";

const DEFAULT_WIDTH = 300;

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  side: "left" | "right";
  open: boolean;
  peek?: boolean;
  width?: number;
}

const edgeMargin: Record<"left" | "right", string> = {
  left: "m-[0_0_var(--surface-inset)_var(--surface-inset)]",
  right: "m-[0_var(--surface-inset)_var(--surface-inset)_0]",
};

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ side, open, peek, width = DEFAULT_WIDTH, className, children, ...props }, ref) => {
    const isCollapsed = !open && !peek;

    return (
      <aside
        ref={ref}
        role="complementary"
        aria-label={`${side === "left" ? "Navigation" : "Inspector"} sidebar`}
        className={cn(
          "shrink-0 flex flex-col select-none overflow-hidden",
          "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
          peek
            ? "absolute inset-y-0 z-40 shadow-[4px_0_24px_rgba(0,0,0,0.4)]"
            : "relative",
          peek && side === "left" && "left-0",
          peek && side === "right" && "right-0",
          className,
        )}
        style={{ width: isCollapsed ? 0 : width }}
        aria-hidden={isCollapsed}
        inert={isCollapsed ? true : undefined}
        {...props}
      >
        <Surface
          variant="main"
          className={cn(
            "flex-1 flex flex-col min-h-0 rounded-[var(--surface-radius)]",
            edgeMargin[side],
          )}
        >
          {children}
        </Surface>
      </aside>
    );
  },
);
Sidebar.displayName = "Sidebar";

export { Sidebar };

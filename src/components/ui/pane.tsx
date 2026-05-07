import * as React from "react";

import { cn } from "@/ui/lib/utils";

export interface PaneProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
}

const Pane = React.forwardRef<HTMLDivElement, PaneProps>(
  ({ open = true, className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col overflow-hidden",
          "transition-[flex,width,opacity] duration-200 ease-in-out motion-reduce:transition-none",
          open ? "flex-1 min-w-0 opacity-100" : "flex-[0] w-0 opacity-0",
          className,
        )}
        aria-hidden={!open}
        inert={!open ? true : undefined}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Pane.displayName = "Pane";

export { Pane };

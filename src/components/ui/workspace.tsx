import * as React from "react";

import { cn } from "@/ui/lib/utils";
import { Surface } from "./surface";

export interface WorkspaceProps extends React.HTMLAttributes<HTMLDivElement> {}

const Workspace = React.forwardRef<HTMLDivElement, WorkspaceProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Surface
        ref={ref}
        variant="main"
        className={cn(
          "flex min-w-0 flex-1 rounded-[var(--surface-radius)] [contain:paint]",
          "m-[0_0_var(--surface-inset)_0]",
          className,
        )}
        {...props}
      >
        {children}
      </Surface>
    );
  },
);
Workspace.displayName = "Workspace";

export { Workspace };

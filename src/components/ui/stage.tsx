import * as React from "react";

import { cn } from "@/ui/lib/utils";
import { Surface } from "./surface";

export interface StageProps extends React.HTMLAttributes<HTMLDivElement> {}

const Stage = React.forwardRef<HTMLDivElement, StageProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Surface
        ref={ref}
        variant="stage"
        className={cn(
          "flex-1 flex flex-col min-w-[480px] overflow-hidden",
          "rounded-[10px] shadow-[var(--surface-shadow)] relative isolate",
          className,
        )}
        {...props}
      >
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </Surface>
    );
  },
);
Stage.displayName = "Stage";

export { Stage };

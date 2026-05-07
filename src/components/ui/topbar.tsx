import * as React from "react";

import { cn } from "@/ui/lib/utils";

export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {}

const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <header
        ref={ref}
        className={cn("relative shrink-0 flex items-center", className)}
        {...props}
      >
        <div className="absolute inset-0 titlebar-drag-region" aria-hidden="true" />
        {children}
      </header>
    );
  },
);
TopBar.displayName = "TopBar";

export { TopBar };

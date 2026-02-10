import * as React from 'react';
import { cn } from '@ui/lib/utils';

export type SelectProps = React.ComponentPropsWithoutRef<'select'>;

const Select = React.forwardRef<React.ElementRef<'select'>, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);

Select.displayName = 'Select';

export { Select };

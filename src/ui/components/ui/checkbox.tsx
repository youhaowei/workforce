import * as React from 'react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import { cn } from '@ui/lib/utils';

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>;

const Checkbox = React.forwardRef<React.ElementRef<typeof RadixCheckbox.Root>, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <RadixCheckbox.Root
      ref={ref}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-sm border border-zinc-300 bg-white text-zinc-900 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-zinc-900 data-[state=checked]:text-zinc-50',
        className
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center text-[10px] leading-none">
        ✓
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
);

Checkbox.displayName = 'Checkbox';

export { Checkbox };

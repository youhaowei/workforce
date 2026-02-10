import * as React from 'react';
import { Label as RadixLabel } from 'radix-ui';
import { cn } from '@ui/lib/utils';

export type LabelProps = React.ComponentPropsWithoutRef<typeof RadixLabel.Root>;

const Label = React.forwardRef<React.ElementRef<typeof RadixLabel.Root>, LabelProps>(({ className, ...props }, ref) => (
  <RadixLabel.Root
    ref={ref}
    className={cn('text-sm font-medium leading-none text-zinc-800 peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
    {...props}
  />
));

Label.displayName = 'Label';

export { Label };

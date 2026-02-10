import * as React from 'react';
import { Separator as RadixSeparator } from 'radix-ui';
import { cn } from '@ui/lib/utils';

interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof RadixSeparator.Root> {
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: SeparatorProps): React.ReactElement {
  return (
    <RadixSeparator.Root
      className={cn(
        'shrink-0 border-0 bg-zinc-200',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      decorative
      orientation={orientation}
      {...props}
    />
  );
}

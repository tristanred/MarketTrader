import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Padded body region for {@link Panel}. Defaults to compact padding
 * (`px-2.5 py-2`) matching the dense terminal aesthetic. Consumers needing
 * looser spacing pass their own padding via `className`.
 */
export const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex-1 px-2.5 py-2', className)} {...props} />
  ),
);
PanelBody.displayName = 'PanelBody';

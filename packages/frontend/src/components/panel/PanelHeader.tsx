import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Right-aligned slot, typically a "LIVE" pill or an action affordance. */
  right?: React.ReactNode;
}

/**
 * Header bar for {@link Panel}. Renders its children as a small-caps mono
 * label on the left with optional `right` content on the far right, both
 * sitting on a hairline-bottom 28px-tall strip.
 */
export const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ className, children, right, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-7 items-center justify-between border-b border-hairline px-2.5',
        'text-[10px] font-mono uppercase tracking-[0.14em] text-muted',
        className,
      )}
      {...props}
    >
      <span className={cn('font-mono uppercase tracking-[0.14em] text-muted')}>{children}</span>
      {right ? <span className="flex items-center gap-2">{right}</span> : null}
    </div>
  ),
);
PanelHeader.displayName = 'PanelHeader';

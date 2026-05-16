import * as React from 'react';
import { cn } from '@/lib/utils';

/** Props for {@link PanelHeader}. Extends all standard `<div>` attributes. */
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
      {/* Typography classes are repeated on this span so getByText() lands on an
          element carrying them — Panel.test.tsx asserts them on the label. Don't
          DRY this up without updating those assertions. */}
      <span className="font-mono uppercase tracking-[0.14em] text-muted">{children}</span>
      {right ? <span className="flex items-center gap-2">{right}</span> : null}
    </div>
  ),
);
PanelHeader.displayName = 'PanelHeader';

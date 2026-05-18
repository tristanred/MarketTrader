import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The shared module chrome used by every "panel" in the new design —
 * leaderboard, portfolio, watchlist, activity, chart, etc. Provides the
 * 1px hairline border, 6px radius, and `--panel` surface fill. Layout
 * (header, body, columns) is left to the consumer.
 */
export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-panel border border-hairline-strong bg-panel',
        'flex flex-col',
        className,
      )}
      {...props}
    />
  ),
);
Panel.displayName = 'Panel';

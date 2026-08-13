import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface LedgerRowProps {
  label: string;
  children: ReactNode;
  className?: string;
  /** Overrides the value's colour — e.g. `text-loss` for a terminal state. */
  valueClassName?: string;
}

/**
 * One term of a game's deal, set like a printed statement: label on the left,
 * value on the right, a dashed leader binding the two across the gap. Shared
 * by the game info modal and the invite landing page so both read as the same
 * document.
 */
export function LedgerRow({ label, children, className, valueClassName }: LedgerRowProps) {
  return (
    <div className={cn('flex items-baseline gap-2', className)}>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      <span
        aria-hidden
        className="min-w-[1rem] flex-1 border-b border-dashed border-hairline-strong"
      />
      <span className={cn('shrink-0 font-mono text-xs text-text-strong', valueClassName)}>
        {children}
      </span>
    </div>
  );
}

import type { TradeDirection } from '@markettrader/shared';
import { cn } from '@/lib/utils';

export interface DirectionLabelProps {
  direction: TradeDirection;
  className?: string;
}

/**
 * Renders a buy/sell label with both a color and a directional glyph so
 * the state isn't conveyed by color alone — important for users with
 * red-green color deficiency.
 */
export function DirectionLabel({ direction, className }: DirectionLabelProps) {
  const isBuy = direction === 'buy';
  return (
    <span
      className={cn(
        'uppercase text-xs font-semibold',
        isBuy ? 'text-gain' : 'text-loss',
        className,
      )}
    >
      <span aria-hidden="true">{isBuy ? '▲' : '▼'}</span> {direction}
    </span>
  );
}

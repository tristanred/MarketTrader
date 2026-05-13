import { SymbolButton } from '@/components/SymbolButton';
import { useLiveStore } from '@/stores/liveStore';
import { useStockQuote, useStockDetails } from '@/api/stocks';
import { cn, formatCompactNumber, formatPct, formatUSD } from '@/lib/utils';

interface Props {
  symbol: string;
  /** When true, render an "X" remove button on the right (edit mode). */
  removable?: boolean;
  onRemove?: () => void;
}

/**
 * Single watchlist row: ▲/▼ + symbol/name on the left, price/volume in the
 * middle, change%/change$ on the right. Uses the WS live store first and
 * falls back to a REST snapshot for symbols that haven't ticked yet.
 */
export function WatchlistRow({ symbol, removable = false, onRemove }: Props) {
  const live = useLiveStore((s) => s.pricesBySymbol[symbol]);
  const snapshot = useStockQuote(symbol);
  const details = useStockDetails(symbol);

  const price = live?.price ?? snapshot.data?.price;
  const change = live?.change ?? snapshot.data?.change ?? 0;
  const changePct = live?.changePercent ?? snapshot.data?.changePercent ?? 0;
  const volume = live?.volume ?? details.data?.dayVolume;
  const name = details.data?.companyName;

  const dir: 'up' | 'down' | 'flat' = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const colorClass =
    dir === 'up'
      ? 'text-green-600 dark:text-green-400'
      : dir === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '·';

  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2 align-top">
        <div className="flex items-baseline gap-1">
          <span className={cn('font-semibold', colorClass)}>{arrow}</span>
          <SymbolButton symbol={symbol} className={cn('font-semibold', colorClass)} />
        </div>
        {name && (
          <div className="ml-4 truncate text-[11px] text-muted-foreground" title={name}>
            {name}
          </div>
        )}
      </td>
      <td className="py-2 text-right align-top tabular-nums">
        <div>{price !== undefined ? formatUSD(price) : '—'}</div>
        <div className="text-[11px] text-muted-foreground">
          {volume !== undefined ? `Vol. ${formatCompactNumber(volume)}` : ''}
        </div>
      </td>
      <td className={cn('py-2 text-right align-top tabular-nums', colorClass)}>
        <div>{formatPct(changePct)}</div>
        <div className="text-[11px]">
          {change >= 0 ? formatUSD(change) : `-${formatUSD(Math.abs(change))}`}
        </div>
      </td>
      {removable && (
        <td className="py-2 pl-1 text-right align-top">
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${symbol}`}
            title="Remove"
          >
            ×
          </button>
        </td>
      )}
    </tr>
  );
}

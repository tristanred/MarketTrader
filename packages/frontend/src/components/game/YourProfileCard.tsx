import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePortfolio } from '@/api/trades';
import { useGame } from '@/api/games';
import { useAuthStore } from '@/stores/authStore';
import { useLiveStore } from '@/stores/liveStore';
import { formatPct, formatUSD, cn } from '@/lib/utils';

/**
 * Hash a string to a stable HSL color. Used to pick a chart segment color
 * per ticker so the same symbol always renders the same shade.
 */
function symbolColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 45%)`;
}

interface MetricProps {
  label: string;
  value: string;
  help?: string;
  tone?: 'positive' | 'negative' | 'neutral';
}

function Metric({ label, value, help, tone = 'neutral' }: MetricProps) {
  return (
    <div>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <span>{label}</span>
        {help && (
          <span title={help} className="cursor-help text-muted-foreground/60">
            ?
          </span>
        )}
      </div>
      <div
        className={cn(
          'mt-0.5 text-lg font-medium tabular-nums',
          tone === 'positive' && 'text-green-600 dark:text-green-400',
          tone === 'negative' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function YourProfileCard({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const portfolio = usePortfolio(gameId);
  const user = useAuthStore((s) => s.user);
  const livePrices = useLiveStore((s) => s.pricesBySymbol);
  const liveBoard = useLiveStore((s) => s.leaderboard);

  // Recompute holdings + total with live prices when available. The server
  // already includes pending-order reservations in `reservedValue`; pass that
  // through so a queued buy doesn't masquerade as a loss.
  const computed = useMemo(() => {
    if (!portfolio.data) return null;
    const { cashBalance, holdings, reservedValue } = portfolio.data;
    const enriched = holdings.map((h) => {
      const live = livePrices[h.symbol]?.price;
      const price = live ?? h.currentPrice;
      return { ...h, currentPrice: price, marketValue: price * h.quantity };
    });
    const totalValue =
      cashBalance + enriched.reduce((s, h) => s + h.marketValue, 0) + reservedValue;
    return { cashBalance, enriched, totalValue, reservedValue };
  }, [portfolio.data, livePrices]);

  const myRank = useMemo(() => {
    const board = liveBoard ?? game.data?.leaderboard ?? null;
    if (!board || !user) return null;
    return board.find((e) => e.playerId === user.id)?.rank ?? null;
  }, [liveBoard, game.data?.leaderboard, user]);

  if (portfolio.isLoading || !computed || !game.data || !user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { cashBalance, enriched, totalValue, reservedValue } = computed;
  const startingBalance = game.data.startingBalance;
  const overallGains = totalValue - startingBalance;
  const overallReturnsPct = startingBalance !== 0 ? (overallGains / startingBalance) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="uppercase tracking-wide text-xs text-muted-foreground">
            Your profile
          </CardTitle>
          {myRank !== null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Current rank</span>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold tabular-nums">
                {myRank}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">{user.username}</h2>
          <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
            Me
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          <Metric label="Net Worth" value={formatUSD(totalValue)} />
          <Metric label="Today's Gains" value="—" help="Daily P&L tracking coming soon" />
          <Metric
            label="Overall Gains"
            value={formatUSD(overallGains)}
            tone={overallGains > 0 ? 'positive' : overallGains < 0 ? 'negative' : 'neutral'}
          />
          <Metric
            label="Overall Returns"
            value={formatPct(overallReturnsPct)}
            tone={overallReturnsPct > 0 ? 'positive' : overallReturnsPct < 0 ? 'negative' : 'neutral'}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          <Metric label="Cash Remaining" help="Uninvested cash" value={formatUSD(cashBalance)} />
          <Metric
            label="Buying Power"
            help="Cash available to deploy (no margin in this app)"
            value={formatUSD(cashBalance)}
          />
          <Metric
            label="Reserved"
            help="Cash or shares tied up in pending orders awaiting market open"
            value={formatUSD(reservedValue)}
          />
          <Metric label="Cash Borrowed" help="Not used — no margin in this app" value={formatUSD(0)} />
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-2">Portfolio Allocation</div>
          <AllocationBar
            cash={cashBalance}
            reserved={reservedValue}
            total={totalValue}
            holdings={enriched.map((h) => ({ symbol: h.symbol, marketValue: h.marketValue }))}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AllocationBar({
  cash,
  reserved,
  total,
  holdings,
}: {
  cash: number;
  reserved: number;
  total: number;
  holdings: { symbol: string; marketValue: number }[];
}) {
  if (total <= 0) {
    return <div className="h-3 w-full rounded bg-muted" />;
  }
  const segments = [
    { key: 'cash', label: 'Cash', value: cash, color: 'hsl(142 70% 42%)' },
    ...(reserved > 0
      ? [{ key: 'reserved', label: 'Reserved', value: reserved, color: 'hsl(42 90% 55%)' }]
      : []),
    ...holdings.map((h) => ({
      key: h.symbol,
      label: h.symbol,
      value: h.marketValue,
      color: symbolColor(h.symbol),
    })),
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${formatUSD(s.value)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span>
              {s.label} {((s.value / total) * 100).toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

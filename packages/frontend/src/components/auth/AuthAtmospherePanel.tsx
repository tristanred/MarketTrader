import { useFeaturedGames } from '@/api/publicGames';
import { cn } from '@/lib/utils';
import type { FeaturedGame } from '@markettrader/shared';

const FAUX_TICKER = [
  { symbol: '^GSPC', last: '5,284.12', pct: '+0.32%', positive: true },
  { symbol: '^IXIC', last: '16,742.39', pct: '+0.51%', positive: true },
  { symbol: 'AAPL', last: '189.42', pct: '+0.84%', positive: true },
  { symbol: 'TSLA', last: '241.05', pct: '−1.12%', positive: false },
  { symbol: 'NVDA', last: '1,178.30', pct: '+2.41%', positive: true },
];

/**
 * Decorative-but-real side panel for the Login + Register pages. Pulls
 * the top active tournaments from the public, unauthenticated
 * `/public/featured-games` endpoint and groups players under each
 * game so visitors can see what's actually being played. Falls back
 * silently to a near-empty layout if the request fails — this panel
 * is `aria-hidden` and exists primarily to set mood.
 */
export function AuthAtmospherePanel({ className }: { className?: string }) {
  const featured = useFeaturedGames();

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative hidden h-full flex-col justify-between overflow-hidden border-r border-hairline-strong bg-bg p-8 lg:flex',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-bold tracking-[-0.02em] text-text-strong">
        <span className="inline-block h-2 w-2 rounded-[2px] bg-accent" />
        MarketTrader
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden py-8">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">
          Top Tournaments
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
          {featured.isLoading ? <FeaturedSkeleton /> : null}
          {featured.data?.map((game) => <FeaturedGameBlock key={game.id} game={game} />)}
          {!featured.isLoading && (featured.data?.length ?? 0) === 0 ? (
            <p className="font-mono text-[11px] text-muted">No active tournaments.</p>
          ) : null}
        </div>
      </div>

      <div className="flex h-6 items-center gap-6 overflow-hidden whitespace-nowrap border-t border-hairline-strong pt-2 font-mono text-[11px]">
        {FAUX_TICKER.map((t) => (
          <span key={t.symbol} className="flex items-baseline gap-1">
            <span className="text-text">{t.symbol}</span>
            <span className="text-muted">{t.last}</span>
            <span className={t.positive ? 'text-gain' : 'text-loss'}>{t.pct}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FeaturedGameBlock({ game }: { game: FeaturedGame }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline-strong pb-1">
        <span className="font-mono text-xs text-text-strong">{game.name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          DAY {game.dayCurrent}/{game.dayTotal}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {game.leaderboard.map((row) => (
          <li
            key={row.rank}
            className="grid grid-cols-[28px_1fr_auto_auto] items-baseline gap-3 text-xs"
          >
            <span className="font-mono text-[10px] text-muted">
              {String(row.rank).padStart(2, '0')}
            </span>
            <span className="text-text">{row.username}</span>
            <span className="font-mono text-text">{formatUSD(row.totalValue)}</span>
            <span
              className={cn(
                'font-mono',
                row.pnlPct >= 0 ? 'text-gain' : 'text-loss',
              )}
            >
              {formatPct(row.pnlPct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="h-3 w-32 rounded-chip bg-hairline" />
          <div className="h-2 w-full rounded-chip bg-hairline" />
          <div className="h-2 w-full rounded-chip bg-hairline" />
          <div className="h-2 w-3/4 rounded-chip bg-hairline" />
        </div>
      ))}
    </div>
  );
}

function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

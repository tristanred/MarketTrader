import { cn } from '@/lib/utils';

const FAUX_LEADERBOARD = [
  { rank: 1, name: 'tristan', value: '$128,430', pnl: '+28.43%', positive: true },
  { rank: 2, name: 'marcus', value: '$118,902', pnl: '+18.90%', positive: true },
  { rank: 3, name: 'jules', value: '$96,210', pnl: '−3.79%', positive: false },
  { rank: 4, name: 'ari', value: '$94,012', pnl: '−5.99%', positive: false },
];

const FAUX_TICKER = [
  { symbol: '^GSPC', last: '5,284.12', pct: '+0.32%', positive: true },
  { symbol: '^IXIC', last: '16,742.39', pct: '+0.51%', positive: true },
  { symbol: 'AAPL', last: '189.42', pct: '+0.84%', positive: true },
  { symbol: 'TSLA', last: '241.05', pct: '−1.12%', positive: false },
  { symbol: 'NVDA', last: '1,178.30', pct: '+2.41%', positive: true },
];

/**
 * Decorative side panel for the Login + Register pages. Renders a faux
 * leaderboard and faux ticker strip at low opacity to set the terminal
 * mood without distracting from the form. Pure presentation — no API
 * calls, no live data.
 */
export function AuthAtmospherePanel({ className }: { className?: string }) {
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

      <div className="opacity-25">
        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted">Leaderboard</div>
        <ul className="space-y-1.5">
          {FAUX_LEADERBOARD.map((row) => (
            <li
              key={row.rank}
              className="grid grid-cols-[28px_1fr_auto_auto] items-baseline gap-3 text-xs"
            >
              <span className="font-mono text-[10px] text-muted">
                {String(row.rank).padStart(2, '0')}
              </span>
              <span className="text-text">{row.name}</span>
              <span className="font-mono text-text">{row.value}</span>
              <span className={cn('font-mono', row.positive ? 'text-gain' : 'text-loss')}>
                {row.pnl}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="opacity-25">
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
    </div>
  );
}

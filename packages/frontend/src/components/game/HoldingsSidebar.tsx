import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { usePortfolio } from '@/api/trades';
import { useLiveStore } from '@/stores/liveStore';
import { formatPct, formatUSD, cn } from '@/lib/utils';

type SortKey = 'ticker-asc' | 'value-desc' | 'gain-desc';

export function HoldingsSidebar({ gameId }: { gameId: string }) {
  const portfolio = usePortfolio(gameId);
  const livePrices = useLiveStore((s) => s.pricesBySymbol);
  const [sort, setSort] = useState<SortKey>('ticker-asc');

  const rows = useMemo(() => {
    if (!portfolio.data) return [];
    const enriched = portfolio.data.holdings.map((h) => {
      const live = livePrices[h.symbol];
      const currentPrice = live ? live.price : h.currentPrice;
      const marketValue = currentPrice * h.quantity;
      const gainLoss = (currentPrice - h.avgCostBasis) * h.quantity;
      const change = live ? live.change : 0;
      const changePct = live ? live.changePercent : 0;
      return { ...h, currentPrice, marketValue, gainLoss, change, changePct };
    });
    if (sort === 'ticker-asc') enriched.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else if (sort === 'value-desc') enriched.sort((a, b) => b.marketValue - a.marketValue);
    else if (sort === 'gain-desc') enriched.sort((a, b) => b.gainLoss - a.gainLoss);
    return enriched;
  }, [portfolio.data, livePrices, sort]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your portfolio
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="holdings">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="watchlist" disabled>
              Watchlist
            </TabsTrigger>
          </TabsList>
          <TabsContent value="holdings" className="space-y-3 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex-1 text-xs">
                <span className="block text-muted-foreground mb-1">Sort By</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="w-full h-9 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="ticker-asc">TICKER (A-Z)</option>
                  <option value="value-desc">VALUE (HIGH-LOW)</option>
                  <option value="gain-desc">GAIN/LOSS (HIGH-LOW)</option>
                </select>
              </label>
            </div>

            {portfolio.isLoading && <Skeleton className="h-24 w-full" />}
            {!portfolio.isLoading && rows.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">No holdings yet.</p>
            )}

            {rows.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">
                      Symbol<br />
                      <span className="text-[10px]">Shares</span>
                    </th>
                    <th className="py-1.5 text-right font-normal">
                      Price<br />
                      <span className="text-[10px]">Chg/Chg %</span>
                    </th>
                    <th className="py-1.5 text-right font-normal">
                      Value<br />
                      <span className="text-[10px]">Gain/Loss</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.symbol} className="border-b last:border-b-0">
                      <td className="py-2 align-top">
                        <div className="font-semibold">{r.symbol}</div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">{r.quantity}</div>
                      </td>
                      <td className="py-2 text-right align-top tabular-nums">
                        <div>{formatUSD(r.currentPrice)}</div>
                        <div
                          className={cn(
                            'text-[11px]',
                            r.change > 0 && 'text-green-600 dark:text-green-400',
                            r.change < 0 && 'text-destructive',
                            r.change === 0 && 'text-muted-foreground',
                          )}
                        >
                          {r.change.toFixed(2)} {formatPct(r.changePct)}
                        </div>
                      </td>
                      <td className="py-2 text-right align-top tabular-nums">
                        <div>{formatUSD(r.marketValue)}</div>
                        <div
                          className={cn(
                            'text-[11px]',
                            r.gainLoss > 0 && 'text-green-600 dark:text-green-400',
                            r.gainLoss < 0 && 'text-destructive',
                            r.gainLoss === 0 && 'text-muted-foreground',
                          )}
                        >
                          {formatUSD(r.gainLoss)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TabsContent>
          <TabsContent value="watchlist" className="py-6 text-center text-xs text-muted-foreground">
            Watchlist coming soon.
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

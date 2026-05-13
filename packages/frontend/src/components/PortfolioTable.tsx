import { useLiveStore } from '@/stores/liveStore';
import { usePortfolio } from '@/api/trades';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUSD, formatPct, cn } from '@/lib/utils';

export function PortfolioTable({ gameId }: { gameId: string }) {
  const portfolio = usePortfolio(gameId);
  const livePrices = useLiveStore((s) => s.pricesBySymbol);

  if (portfolio.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (portfolio.isError || !portfolio.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Couldn't load portfolio.</p>
        </CardContent>
      </Card>
    );
  }

  const { cashBalance, holdings, totalValue: snapshotTotal } = portfolio.data;

  // Recompute totalValue with live prices when available.
  const enriched = holdings.map((h) => {
    const live = livePrices[h.symbol];
    const currentPrice = live ? live.price : h.currentPrice;
    const marketValue = currentPrice * h.quantity;
    const pnl = (currentPrice - h.avgCostBasis) * h.quantity;
    const pnlPct = h.avgCostBasis !== 0 ? ((currentPrice - h.avgCostBasis) / h.avgCostBasis) * 100 : 0;
    return { ...h, currentPrice, marketValue, unrealizedPnL: pnl, unrealizedPnLPercent: pnlPct };
  });

  const liveTotal = enriched.length
    ? cashBalance + enriched.reduce((s, h) => s + h.marketValue, 0)
    : snapshotTotal;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <div className="text-muted-foreground">Cash</div>
            <div className="font-medium">{formatUSD(cashBalance)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Total value</div>
            <div className="font-medium">{formatUSD(liveTotal)}</div>
          </div>
        </div>

        {enriched.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holdings yet. Place your first trade.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Market value</TableHead>
                <TableHead className="text-right">P&amp;L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map((h) => (
                <TableRow key={h.symbol}>
                  <TableCell className="font-medium">{h.symbol}</TableCell>
                  <TableCell className="text-right">{h.quantity}</TableCell>
                  <TableCell className="text-right">{formatUSD(h.avgCostBasis)}</TableCell>
                  <TableCell className="text-right">{formatUSD(h.currentPrice)}</TableCell>
                  <TableCell className="text-right">{formatUSD(h.marketValue)}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      h.unrealizedPnL > 0 && 'text-green-600 dark:text-green-400',
                      h.unrealizedPnL < 0 && 'text-destructive',
                    )}
                  >
                    {formatUSD(h.unrealizedPnL)} ({formatPct(h.unrealizedPnLPercent)})
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

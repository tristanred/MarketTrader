import { useMemo } from 'react';
import { useTradeHistory } from '@/api/trades';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUSD, cn } from '@/lib/utils';
import type { Trade, TradeDirection } from '@markettrader/shared';

interface TradeGroup {
  key: string;
  symbol: string;
  direction: TradeDirection;
  price: number;
  totalQuantity: number;
  count: number;
  firstAt: string;
  lastAt: string;
}

function groupTrades(trades: readonly Trade[]): TradeGroup[] {
  const map = new Map<string, TradeGroup>();
  for (const t of trades) {
    const key = `${t.symbol}|${t.direction}|${t.price}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalQuantity += t.quantity;
      existing.count += 1;
      if (t.executedAt < existing.firstAt) existing.firstAt = t.executedAt;
      if (t.executedAt > existing.lastAt) existing.lastAt = t.executedAt;
    } else {
      map.set(key, {
        key,
        symbol: t.symbol,
        direction: t.direction,
        price: t.price,
        totalQuantity: t.quantity,
        count: 1,
        firstAt: t.executedAt,
        lastAt: t.executedAt,
      });
    }
  }
  // Newest group first (by most recent fill in the group).
  return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function formatWhen(g: TradeGroup): string {
  const last = new Date(g.lastAt).toLocaleString();
  if (g.count === 1) return last;
  const first = new Date(g.firstAt).toLocaleString();
  if (first === last) return last;
  return `${first} → ${last}`;
}

export function TradeHistoryTable({ gameId }: { gameId: string }) {
  const history = useTradeHistory(gameId);
  const groups = useMemo(() => (history.data ? groupTrades(history.data) : []), [history.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade history</CardTitle>
      </CardHeader>
      <CardContent>
        {history.isLoading && <Skeleton className="h-24 w-full" />}
        {history.isError && <p className="text-sm text-destructive">Couldn't load history.</p>}
        {history.data && history.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No trades yet.</p>
        )}
        {groups.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell>{formatWhen(g)}</TableCell>
                  <TableCell className="font-medium">{g.symbol}</TableCell>
                  <TableCell
                    className={cn(
                      'uppercase text-xs font-semibold',
                      g.direction === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                    )}
                  >
                    {g.direction}
                  </TableCell>
                  <TableCell className="text-right">
                    {g.totalQuantity}
                    {g.count > 1 && (
                      <span className="ml-1 text-xs text-muted-foreground">({g.count} fills)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatUSD(g.price)}</TableCell>
                  <TableCell className="text-right">{formatUSD(g.price * g.totalQuantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

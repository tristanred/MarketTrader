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

export function TradeHistoryTable({ gameId }: { gameId: string }) {
  const history = useTradeHistory(gameId);

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
        {history.data && history.data.length > 0 && (
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
              {history.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{new Date(t.executedAt).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{t.symbol}</TableCell>
                  <TableCell
                    className={cn(
                      'uppercase text-xs font-semibold',
                      t.direction === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                    )}
                  >
                    {t.direction}
                  </TableCell>
                  <TableCell className="text-right">{t.quantity}</TableCell>
                  <TableCell className="text-right">{formatUSD(t.price)}</TableCell>
                  <TableCell className="text-right">{formatUSD(t.price * t.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

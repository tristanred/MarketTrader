import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePendingTrades, useCancelPendingTrade } from '@/api/trades';
import { toast } from '@/components/ui/toast';
import { formatUSD } from '@/lib/utils';
import { ApiError } from '@/lib/api';

export function PendingOrdersList({ gameId }: { gameId: string }) {
  const { data, isLoading } = usePendingTrades(gameId);
  const cancel = useCancelPendingTrade(gameId);

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  const handleCancel = async (id: string, label: string) => {
    try {
      await cancel.mutateAsync(id);
      toast({ title: `Cancelled ${label}`, variant: 'success' });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body !== null && 'error' in err.body
            ? String((err.body as { error: unknown }).error)
            : `${err.status}`
          : 'Unknown error';
      toast({ title: 'Cancel failed', description: msg, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {data.map((p) => {
            const label = `${p.direction === 'buy' ? 'Buy' : 'Sell'} ${p.quantity} ${p.symbol}`;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div>
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">
                    @ {formatUSD(p.reservedPrice)} · queued{' '}
                    {new Date(p.placedAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => void handleCancel(p.id, label)}
                >
                  Cancel
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

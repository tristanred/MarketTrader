import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePendingTrades, useCancelPendingTrade } from '@/api/trades';
import { toast } from '@/components/ui/toast';
import { formatUSD } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import type { PendingTrade, TradeDirection } from '@markettrader/shared';

interface PendingGroup {
  key: string;
  symbol: string;
  direction: TradeDirection;
  reservedPrice: number;
  totalQuantity: number;
  ids: string[];
  firstAt: string;
  lastAt: string;
}

function groupPending(pendings: readonly PendingTrade[]): PendingGroup[] {
  const map = new Map<string, PendingGroup>();
  for (const p of pendings) {
    const key = `${p.symbol}|${p.direction}|${p.reservedPrice}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalQuantity += p.quantity;
      existing.ids.push(p.id);
      if (p.placedAt < existing.firstAt) existing.firstAt = p.placedAt;
      if (p.placedAt > existing.lastAt) existing.lastAt = p.placedAt;
    } else {
      map.set(key, {
        key,
        symbol: p.symbol,
        direction: p.direction,
        reservedPrice: p.reservedPrice,
        totalQuantity: p.quantity,
        ids: [p.id],
        firstAt: p.placedAt,
        lastAt: p.placedAt,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
}

function formatQueuedAt(g: PendingGroup): string {
  const first = new Date(g.firstAt).toLocaleString();
  if (g.ids.length === 1) return first;
  const last = new Date(g.lastAt).toLocaleString();
  if (first === last) return first;
  return `${first} → ${last}`;
}

export function PendingOrdersList({ gameId }: { gameId: string }) {
  const { data, isLoading } = usePendingTrades(gameId);
  const cancel = useCancelPendingTrade(gameId);
  const groups = useMemo(() => (data ? groupPending(data) : []), [data]);

  if (isLoading) return null;
  if (groups.length === 0) return null;

  const handleCancelGroup = async (g: PendingGroup) => {
    const label = `${g.direction === 'buy' ? 'Buy' : 'Sell'} ${g.totalQuantity} ${g.symbol}`;
    const results = await Promise.allSettled(g.ids.map((id) => cancel.mutateAsync(id)));
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === 0) {
      toast({ title: `Cancelled ${label}`, variant: 'success' });
      return;
    }
    const first = failures[0];
    const reason = first?.status === 'rejected' ? first.reason : undefined;
    const msg =
      reason instanceof ApiError
        ? typeof reason.body === 'object' && reason.body !== null && 'error' in reason.body
          ? String((reason.body as { error: unknown }).error)
          : `${reason.status}`
        : reason instanceof Error
          ? reason.message
          : 'Unknown error';
    toast({
      title: `${failures.length} of ${g.ids.length} cancels failed`,
      description: msg,
      variant: 'destructive',
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {groups.map((g) => {
            const label = `${g.direction === 'buy' ? 'Buy' : 'Sell'} ${g.totalQuantity} ${g.symbol}`;
            return (
              <li
                key={g.key}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div>
                  <div className="font-medium">
                    {label}
                    {g.ids.length > 1 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({g.ids.length} orders)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    @ {formatUSD(g.reservedPrice)} · queued {formatQueuedAt(g)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => void handleCancelGroup(g)}
                >
                  Cancel{g.ids.length > 1 ? ' all' : ''}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

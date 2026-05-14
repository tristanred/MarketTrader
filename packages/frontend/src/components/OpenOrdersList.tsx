import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SymbolButton } from '@/components/SymbolButton';
import {
  usePendingTrades,
  useCancelPendingTrade,
  useWorkingOrders,
  useCancelWorkingOrder,
} from '@/api/trades';
import { toast } from '@/components/ui/toast';
import { formatUSD, cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import type { PendingTrade, WorkingOrder } from '@markettrader/shared';

/**
 * Unified row model spanning the two backend resting-order kinds:
 * - `working`: limit / stop / stop_limit / bracket waiting on a price trigger.
 * - `pending`: market-hours queue (placed while the market was closed).
 *
 * Bracket parents subsume their TP/SL children in the list (children are
 * filtered out while the parent is still working). After the parent fills,
 * the children appear as independent working rows so they can be cancelled.
 */
type Row =
  | { kind: 'working'; order: WorkingOrder; placedAt: string }
  | { kind: 'pending'; trade: PendingTrade; placedAt: string };

function describeOrder(o: WorkingOrder): { type: string; trigger: string } {
  switch (o.orderType) {
    case 'limit':
      return { type: 'Limit', trigger: `@ ${formatUSD(Number(o.limitPrice))}` };
    case 'stop':
      return { type: 'Stop', trigger: `Stop ${formatUSD(Number(o.stopPrice))}` };
    case 'stop_limit':
      return {
        type: 'Stop-Limit',
        trigger: `Stop ${formatUSD(Number(o.stopPrice))} → Limit ${formatUSD(Number(o.limitPrice))}`,
      };
    case 'bracket':
    case 'market':
      // Bracket entry parent: show TP/SL in one row.
      if (o.bracketRole === 'entry') {
        const entry =
          o.limitPrice != null ? `Limit ${formatUSD(Number(o.limitPrice))}` : 'Market';
        const tp = o.takeProfitPrice != null ? formatUSD(Number(o.takeProfitPrice)) : '—';
        const sl = o.stopLossPrice != null ? formatUSD(Number(o.stopLossPrice)) : '—';
        return { type: 'Bracket', trigger: `Entry ${entry} · TP ${tp} / SL ${sl}` };
      }
      // Orphaned market row inside a working state — shouldn't appear,
      // but format defensively.
      return { type: 'Market', trigger: 'Market' };
  }
}

function describePending(p: PendingTrade): { type: string; trigger: string } {
  return { type: 'Market', trigger: `Queued @ ${formatUSD(p.reservedPrice)}` };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function OpenOrdersList({ gameId }: { gameId: string }) {
  const working = useWorkingOrders(gameId);
  const pending = usePendingTrades(gameId);
  const cancelWorking = useCancelWorkingOrder(gameId);
  const cancelPending = useCancelPendingTrade(gameId);

  const rows = useMemo<Row[]>(() => {
    const w = working.data ?? [];
    const p = pending.data ?? [];

    // Bracket-child filter: while a bracket parent (entry) is still working,
    // hide its TP/SL children. Once the parent fills (no longer in `working`),
    // children surface as independent rows.
    const workingParentIds = new Set(
      w.filter((o) => o.bracketRole === 'entry').map((o) => o.id),
    );
    const filteredWorking = w.filter(
      (o) => o.parentTradeId == null || !workingParentIds.has(o.parentTradeId),
    );

    const items: Row[] = [
      ...filteredWorking.map((o) => ({ kind: 'working' as const, order: o, placedAt: o.placedAt })),
      ...p.map((t) => ({ kind: 'pending' as const, trade: t, placedAt: t.placedAt })),
    ];
    items.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    return items;
  }, [working.data, pending.data]);

  if (working.isLoading || pending.isLoading) return null;
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Symbol</th>
                <th className="px-2 py-2">Side</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Trigger</th>
                <th className="px-2 py-2">TIF</th>
                <th className="px-2 py-2">Placed</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <OrderRow
                  key={row.kind === 'working' ? row.order.id : row.trade.id}
                  row={row}
                  isCancelling={cancelWorking.isPending || cancelPending.isPending}
                  onCancel={async () => {
                    try {
                      if (row.kind === 'working') {
                        await cancelWorking.mutateAsync(row.order.id);
                      } else {
                        await cancelPending.mutateAsync(row.trade.id);
                      }
                      toast({ title: 'Order cancelled', variant: 'success' });
                    } catch (err) {
                      toast({
                        title: 'Cancel failed',
                        description: extractMessage(err),
                        variant: 'destructive',
                      });
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderRow({
  row,
  isCancelling,
  onCancel,
}: {
  row: Row;
  isCancelling: boolean;
  onCancel: () => void;
}) {
  const isWorking = row.kind === 'working';
  const symbol = isWorking ? row.order.symbol : row.trade.symbol;
  const direction = isWorking ? row.order.direction : row.trade.direction;
  const quantity = isWorking ? row.order.quantity : row.trade.quantity;
  const tif = isWorking ? row.order.timeInForce.toUpperCase() : '—';
  const placed = isWorking ? row.order.placedAt : row.trade.placedAt;
  const { type, trigger } = isWorking ? describeOrder(row.order) : describePending(row.trade);

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-2 py-2 font-medium">
        <SymbolButton symbol={symbol} />
      </td>
      <td className={cn('px-2 py-2 uppercase text-xs font-semibold', direction === 'buy' ? 'text-green-600' : 'text-red-600')}>
        {direction}
      </td>
      <td className="px-2 py-2 tabular-nums">{quantity}</td>
      <td className="px-2 py-2">{type}</td>
      <td className="px-2 py-2 text-muted-foreground">{trigger}</td>
      <td className="px-2 py-2 text-xs">{tif}</td>
      <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(placed)}</td>
      <td className="px-2 py-2">
        <span
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold',
            isWorking ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800',
          )}
        >
          {isWorking ? 'Working' : 'Pending'}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <Button variant="outline" size="sm" disabled={isCancelling} onClick={onCancel}>
          Cancel
        </Button>
      </td>
    </tr>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (typeof rec['message'] === 'string') return rec['message'];
      if (typeof rec['error'] === 'string') return rec['error'];
    }
    return `${err.status} ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

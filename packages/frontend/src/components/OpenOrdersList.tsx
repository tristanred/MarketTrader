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
 * One displayed row in the Open Orders table. Identical orders fold into a
 * single group so a player who placed five buys of AAPL at the same price
 * sees one row with `qty=5 (5 orders)` rather than five duplicate rows.
 *
 * Bracket orders are deliberately *not* grouped: each bracket has its own
 * TP/SL semantics tied to a specific entry, so collapsing them would hide
 * meaningful per-order state.
 */
interface OrderGroup {
  /** Stable identity for React keys + cancellation. */
  key: string;
  kind: 'working' | 'pending';
  symbol: string;
  direction: 'buy' | 'sell';
  totalQuantity: number;
  /** Per-order ids — used to cancel all rows in the group on a single click. */
  ids: string[];
  type: string;
  trigger: string;
  tif: string;
  firstAt: string;
  lastAt: string;
}

function describeWorking(o: WorkingOrder): { type: string; trigger: string } {
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
      if (o.bracketRole === 'entry') {
        const entry =
          o.limitPrice != null ? `Limit ${formatUSD(Number(o.limitPrice))}` : 'Market';
        const tp = o.takeProfitPrice != null ? formatUSD(Number(o.takeProfitPrice)) : '—';
        const sl = o.stopLossPrice != null ? formatUSD(Number(o.stopLossPrice)) : '—';
        return { type: 'Bracket', trigger: `Entry ${entry} · TP ${tp} / SL ${sl}` };
      }
      return { type: 'Market', trigger: 'Market' };
  }
}

function describePending(p: PendingTrade): { type: string; trigger: string } {
  return { type: 'Market', trigger: `Queued @ ${formatUSD(p.reservedPrice)}` };
}

/**
 * Returns a grouping key that's identical only for orders the user would
 * see as duplicates. Brackets carry their per-row id so they never fold
 * together — see {@link OrderGroup} comment.
 */
function workingGroupKey(o: WorkingOrder): string {
  if (o.orderType === 'bracket' || o.bracketRole != null) {
    return `working|bracket|${o.id}`;
  }
  return [
    'working',
    o.symbol,
    o.direction,
    o.orderType,
    o.timeInForce,
    o.limitPrice ?? '',
    o.stopPrice ?? '',
  ].join('|');
}

function pendingGroupKey(p: PendingTrade): string {
  return ['pending', p.symbol, p.direction, p.reservedPrice].join('|');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatRange(g: OrderGroup): string {
  const first = formatDate(g.firstAt);
  if (g.ids.length === 1 || g.firstAt === g.lastAt) return first;
  return `${first} → ${formatDate(g.lastAt)}`;
}

export function OpenOrdersList({ gameId }: { gameId: string }) {
  const working = useWorkingOrders(gameId);
  const pending = usePendingTrades(gameId);
  const cancelWorking = useCancelWorkingOrder(gameId);
  const cancelPending = useCancelPendingTrade(gameId);

  const groups = useMemo<OrderGroup[]>(() => {
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

    const map = new Map<string, OrderGroup>();

    for (const o of filteredWorking) {
      const key = workingGroupKey(o);
      const { type, trigger } = describeWorking(o);
      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += o.quantity;
        existing.ids.push(o.id);
        if (o.placedAt < existing.firstAt) existing.firstAt = o.placedAt;
        if (o.placedAt > existing.lastAt) existing.lastAt = o.placedAt;
      } else {
        map.set(key, {
          key,
          kind: 'working',
          symbol: o.symbol,
          direction: o.direction,
          totalQuantity: o.quantity,
          ids: [o.id],
          type,
          trigger,
          tif: o.timeInForce.toUpperCase(),
          firstAt: o.placedAt,
          lastAt: o.placedAt,
        });
      }
    }

    for (const t of p) {
      const key = pendingGroupKey(t);
      const { type, trigger } = describePending(t);
      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += t.quantity;
        existing.ids.push(t.id);
        if (t.placedAt < existing.firstAt) existing.firstAt = t.placedAt;
        if (t.placedAt > existing.lastAt) existing.lastAt = t.placedAt;
      } else {
        map.set(key, {
          key,
          kind: 'pending',
          symbol: t.symbol,
          direction: t.direction,
          totalQuantity: t.quantity,
          ids: [t.id],
          type,
          trigger,
          tif: '—',
          firstAt: t.placedAt,
          lastAt: t.placedAt,
        });
      }
    }

    return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [working.data, pending.data]);

  if (working.isLoading || pending.isLoading) return null;
  if (groups.length === 0) return null;

  const isCancelling = cancelWorking.isPending || cancelPending.isPending;

  const handleCancelGroup = async (g: OrderGroup) => {
    const mutation = g.kind === 'working' ? cancelWorking : cancelPending;
    const results = await Promise.allSettled(g.ids.map((id) => mutation.mutateAsync(id)));
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === 0) {
      toast({
        title: g.ids.length === 1 ? 'Order cancelled' : `${g.ids.length} orders cancelled`,
        variant: 'success',
      });
      return;
    }
    const first = failures[0];
    const reason = first?.status === 'rejected' ? first.reason : undefined;
    toast({
      title: `${failures.length} of ${g.ids.length} cancels failed`,
      description: extractMessage(reason),
      variant: 'destructive',
    });
  };

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
              {groups.map((g) => (
                <OrderRow
                  key={g.key}
                  group={g}
                  isCancelling={isCancelling}
                  onCancel={() => void handleCancelGroup(g)}
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
  group,
  isCancelling,
  onCancel,
}: {
  group: OrderGroup;
  isCancelling: boolean;
  onCancel: () => void;
}) {
  const isWorking = group.kind === 'working';
  const count = group.ids.length;
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-2 py-2 font-medium">
        <SymbolButton symbol={group.symbol} />
      </td>
      <td
        className={cn(
          'px-2 py-2 uppercase text-xs font-semibold',
          group.direction === 'buy' ? 'text-green-600' : 'text-red-600',
        )}
      >
        {group.direction}
      </td>
      <td className="px-2 py-2 tabular-nums">
        {group.totalQuantity}
        {count > 1 && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            ({count} orders)
          </span>
        )}
      </td>
      <td className="px-2 py-2">{group.type}</td>
      <td className="px-2 py-2 text-muted-foreground">{group.trigger}</td>
      <td className="px-2 py-2 text-xs">{group.tif}</td>
      <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {formatRange(group)}
      </td>
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
          Cancel{count > 1 ? ' all' : ''}
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

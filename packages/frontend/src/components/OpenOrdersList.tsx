import { useMemo } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { SymbolButton } from '@/components/SymbolButton';
import { DirectionLabel } from '@/components/DirectionLabel';
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

  const totalOrders = groups.reduce((n, g) => n + g.ids.length, 0);

  return (
    <Panel>
      <PanelHeader>Open Orders · {totalOrders}</PanelHeader>
      <PanelBody>
        <div className="overflow-x-auto scrollbar-always-x">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline text-[9px] uppercase tracking-[0.16em] text-muted">
                <th className="py-1 text-left font-medium">Symbol</th>
                <th className="text-left font-medium">Side</th>
                <th className="text-right font-medium">Qty</th>
                <th className="text-left font-medium">Type</th>
                <th className="text-left font-medium">Trigger</th>
                <th className="text-left font-medium">TIF</th>
                <th className="text-left font-medium">Status</th>
                <th className="text-right font-medium">Placed</th>
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
      </PanelBody>
    </Panel>
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
    <tr className="border-b border-hairline last:border-0">
      <td className="py-1">
        <SymbolButton symbol={group.symbol} className="font-mono text-accent" />
      </td>
      <td>
        <DirectionLabel direction={group.direction} className="text-[11px]" />
      </td>
      <td className="text-right font-mono">
        {group.totalQuantity}
        {count > 1 && (
          <span className="ml-1 text-[10px] font-normal text-muted">
            ({count} orders)
          </span>
        )}
      </td>
      <td className="text-muted">{group.type}</td>
      <td className="font-mono text-muted">{group.trigger}</td>
      <td className="font-mono text-[10px] text-muted">{group.tif}</td>
      <td>
        <StatusCancelBadge
          isWorking={isWorking}
          count={count}
          disabled={isCancelling}
          onCancel={onCancel}
        />
      </td>
      <td className="whitespace-nowrap text-right font-mono text-[10px] text-muted">
        {formatRange(group)}
      </td>
    </tr>
  );
}

/**
 * Status pill that doubles as the cancel control. At rest it shows the order
 * status (Working / Pending). On hover or keyboard focus it swaps to a
 * destructive "✕ Cancel" / "✕ Cancel all" label. Clicking cancels the group.
 */
function StatusCancelBadge({
  isWorking,
  count,
  disabled,
  onCancel,
}: {
  isWorking: boolean;
  count: number;
  disabled: boolean;
  onCancel: () => void;
}) {
  const statusLabel = isWorking ? 'Working' : 'Pending';
  const cancelLabel = count > 1 ? '✕ Cancel all' : '✕ Cancel';
  const baseColor = isWorking ? 'text-gain' : 'text-muted';
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={disabled}
      title={`Cancel ${count > 1 ? `${count} ${statusLabel.toLowerCase()} orders` : `this ${statusLabel.toLowerCase()} order`}`}
      aria-label={cancelLabel}
      className={cn(
        'group/cancel inline-flex items-center font-mono text-[10px] uppercase tracking-[0.14em] transition-colors',
        baseColor,
        'hover:text-loss focus-visible:text-loss',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-loss',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span className="group-hover/cancel:hidden group-focus-visible/cancel:hidden">
        {statusLabel}
      </span>
      <span className="hidden group-hover/cancel:inline group-focus-visible/cancel:inline">
        {cancelLabel}
      </span>
    </button>
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

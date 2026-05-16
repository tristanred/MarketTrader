import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdminGames, useAdminGamePlayers } from '@/api/admin/games';
import {
  useAdminGameTrades,
  useAdminCancelTrade,
  useAdminForceExecuteTrade,
  useAdminReverseTrade,
  useAdminEditTradePrice,
  type AdminGameTradesQuery,
} from '@/api/admin/trades';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { toastApiError } from '@/components/admin/adminErrors';
import type { AdminTradeRow } from '@markettrader/shared';

const PAGE_SIZE = 50;

export function AdminTradesPage() {
  const [params, setParams] = useSearchParams();
  const gameId = params.get('gameId') ?? '';
  const [status, setStatus] = useState<'all' | AdminTradeRow['status']>('all');
  const [symbol, setSymbol] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [offset, setOffset] = useState(0);

  const games = useAdminGames({ limit: 100, offset: 0 });
  const players = useAdminGamePlayers(gameId);

  const query: AdminGameTradesQuery = {
    limit: PAGE_SIZE,
    offset,
    ...(status !== 'all' ? { status } : {}),
    ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
    ...(playerId ? { playerId } : {}),
  };
  const trades = useAdminGameTrades(gameId, query);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Trades</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <Label htmlFor="gameSel">Game</Label>
            <select
              id="gameSel"
              value={gameId}
              onChange={(e) => {
                const id = e.target.value;
                setParams(id ? { gameId: id } : {});
                setPlayerId('');
                setOffset(0);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— select a game —</option>
              {games.data?.games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setOffset(0);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="working">Working</option>
              <option value="executed">Executed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="AAPL"
            />
          </div>
          <div>
            <Label htmlFor="playerSel">Player</Label>
            <select
              id="playerSel"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              disabled={!gameId}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">— any player —</option>
              {players.data?.players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.username}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {!gameId && (
        <p className="text-sm text-muted-foreground">Pick a game to see its trades.</p>
      )}

      {gameId && trades.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {gameId && trades.isError && (
        <p className="text-sm text-destructive">Failed to load trades.</p>
      )}
      {gameId && trades.data && (
        <TradesTable
          rows={trades.data.trades}
          total={trades.data.total}
          offset={offset}
          onOffsetChange={setOffset}
        />
      )}
    </div>
  );
}

function TradesTable({
  rows,
  total,
  offset,
  onOffsetChange,
}: {
  rows: AdminTradeRow[];
  total: number;
  offset: number;
  onOffsetChange: (n: number) => void;
}) {
  const cancel = useAdminCancelTrade();
  const reverse = useAdminReverseTrade();
  const force = useAdminForceExecuteTrade();
  const editPrice = useAdminEditTradePrice();

  const [confirm, setConfirm] = useState<{
    kind: 'cancel' | 'reverse';
    tradeId: string;
  } | null>(null);
  const [forceModal, setForceModal] = useState<{ tradeId: string; price: string } | null>(null);
  const [priceModal, setPriceModal] = useState<{ tradeId: string; price: string } | null>(null);

  async function doConfirm() {
    if (!confirm) return;
    try {
      if (confirm.kind === 'cancel') await cancel.mutateAsync(confirm.tradeId);
      else await reverse.mutateAsync(confirm.tradeId);
      toast({ title: `Trade ${confirm.kind}ed`, variant: 'success' });
      setConfirm(null);
    } catch (err) {
      toastApiError(err, `${confirm.kind} failed`);
    }
  }

  async function doForce() {
    if (!forceModal) return;
    const price = forceModal.price ? Number(forceModal.price) : undefined;
    if (price !== undefined && (!Number.isFinite(price) || price <= 0)) {
      toast({ title: 'Price must be positive', variant: 'destructive' });
      return;
    }
    try {
      await force.mutateAsync({
        tradeId: forceModal.tradeId,
        body: price !== undefined ? { price } : {},
      });
      toast({ title: 'Trade executed', variant: 'success' });
      setForceModal(null);
    } catch (err) {
      toastApiError(err, 'Force execute failed');
    }
  }

  async function doEditPrice() {
    if (!priceModal) return;
    const price = Number(priceModal.price);
    if (!Number.isFinite(price) || price <= 0) {
      toast({ title: 'Price must be positive', variant: 'destructive' });
      return;
    }
    try {
      await editPrice.mutateAsync({ tradeId: priceModal.tradeId, body: { price } });
      toast({ title: 'Price updated', variant: 'success' });
      setPriceModal(null);
    } catch (err) {
      toastApiError(err, 'Price edit failed');
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Placed</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Price</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                No trades match.
              </TableCell>
            </TableRow>
          )}
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link
                  to={`/admin/portfolios?userId=${t.userId}&playerId=${t.gamePlayerId}`}
                  className="font-medium underline hover:text-primary"
                >
                  {t.username}
                </Link>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(t.placedAt).toLocaleString()}
              </TableCell>
              <TableCell className="font-medium">{t.symbol}</TableCell>
              <TableCell>{t.direction}</TableCell>
              <TableCell>{t.quantity}</TableCell>
              <TableCell className="text-xs">{t.status}</TableCell>
              <TableCell className="text-xs">{t.orderType}</TableCell>
              <TableCell>{t.price !== null ? t.price.toFixed(2) : '—'}</TableCell>
              <TableCell className="space-x-1 text-right">
                {(t.status === 'working' || t.status === 'pending') && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setForceModal({ tradeId: t.id, price: '' })}
                    >
                      Force
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirm({ kind: 'cancel', tradeId: t.id })}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {t.status === 'executed' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPriceModal({ tradeId: t.id, price: t.price?.toString() ?? '' })
                      }
                    >
                      Edit price
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirm({ kind: 'reverse', tradeId: t.id })}
                    >
                      Reverse
                    </Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => onOffsetChange(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.kind === 'cancel' ? 'Cancel this trade?' : 'Reverse this trade?'}
        description={
          confirm?.kind === 'cancel'
            ? 'Cancels a working/pending trade and refunds reserved cash if applicable.'
            : 'Reverses an executed trade: refunds cash and restores prior holdings.'
        }
        confirmLabel={confirm?.kind === 'cancel' ? 'Cancel trade' : 'Reverse'}
        destructive
        onConfirm={doConfirm}
      />

      <Dialog open={!!forceModal} onOpenChange={(v) => !v && setForceModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force execute trade</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="forcePrice">Price (optional — defaults to latest quote)</Label>
            <Input
              id="forcePrice"
              type="number"
              step="0.01"
              value={forceModal?.price ?? ''}
              onChange={(e) =>
                setForceModal(forceModal ? { ...forceModal, price: e.target.value } : null)
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForceModal(null)}>
              Cancel
            </Button>
            <Button onClick={doForce} disabled={force.isPending}>
              {force.isPending ? 'Executing…' : 'Force execute'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!priceModal} onOpenChange={(v) => !v && setPriceModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit fill price</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="editPrice">New price</Label>
            <Input
              id="editPrice"
              type="number"
              step="0.01"
              value={priceModal?.price ?? ''}
              onChange={(e) =>
                setPriceModal(priceModal ? { ...priceModal, price: e.target.value } : null)
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceModal(null)}>
              Cancel
            </Button>
            <Button onClick={doEditPrice} disabled={editPrice.isPending}>
              {editPrice.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

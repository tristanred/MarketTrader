import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdminUsers, useAdminUserPlayers, useAdminUser } from '@/api/admin/users';
import {
  useAdminUpdateCash,
  useAdminAdjustHoldings,
  useAdminWipeHoldings,
  useAdminPlayerPortfolio,
} from '@/api/admin/portfolios';
import type { PortfolioResponse } from '@/api/trades';
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
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { toastApiError } from '@/lib/toastApiError';
import { formatUSD, formatPct, cn } from '@/lib/utils';

export function AdminPortfoliosPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('userId') ?? '';
  const playerId = params.get('playerId') ?? '';

  function setUserId(id: string) {
    if (id) setParams({ userId: id });
    else setParams({});
  }
  function setPlayerId(pid: string) {
    if (pid && userId) setParams({ userId, playerId: pid });
    else if (userId) setParams({ userId });
    else setParams({});
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Portfolios</h1>

      {!userId && <UserPicker onPick={setUserId} />}

      {userId && !playerId && (
        <PlayerPicker
          userId={userId}
          onBack={() => setUserId('')}
          onPick={setPlayerId}
        />
      )}

      {userId && playerId && (
        <PlayerEditor
          playerId={playerId}
          userId={userId}
          onBack={() => setPlayerId('')}
        />
      )}
    </div>
  );
}

const USER_PAGE_SIZE = 25;

function UserPicker({ onPick }: { onPick: (userId: string) => void }) {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isError } = useAdminUsers({
    limit: USER_PAGE_SIZE,
    offset,
    sort: 'username',
    ...(q ? { q } : {}),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pick a user</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="Search username…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {isError && <p className="text-sm text-destructive">Failed to load users.</p>}

        {data && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                      No users match.
                    </TableCell>
                  </TableRow>
                )}
                {data.users.map((u) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer"
                    onClick={() => onPick(u.id)}
                  >
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.disabled ? 'Disabled' : 'Active'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPick(u.id);
                        }}
                      >
                        Select
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {offset + 1}–{Math.min(offset + USER_PAGE_SIZE, data.total)} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - USER_PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + USER_PAGE_SIZE >= data.total}
                  onClick={() => setOffset(offset + USER_PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlayerPicker({
  userId,
  onBack,
  onPick,
}: {
  userId: string;
  onBack: () => void;
  onPick: (playerId: string) => void;
}) {
  const { data: user } = useAdminUser(userId);
  const { data, isLoading, isError } = useAdminUserPlayers(userId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {user ? `${user.username}'s games` : 'Pick a game'}
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={onBack}>
            ← Change user
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && <p className="text-sm text-destructive">Failed to load games.</p>}

        {data && data.players.length === 0 && (
          <p className="text-sm text-muted-foreground">This user hasn't joined any games.</p>
        )}
        {data && data.players.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Game</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cash</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.players.map((p) => (
                <TableRow
                  key={p.playerId}
                  className="cursor-pointer"
                  onClick={() => onPick(p.playerId)}
                >
                  <TableCell className="font-medium">{p.gameName}</TableCell>
                  <TableCell className="text-xs">{p.gameStatus}</TableCell>
                  <TableCell>{formatUSD(p.cashBalance)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.joinedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(p.playerId);
                      }}
                    >
                      Edit
                    </Button>
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

function PlayerEditor({
  playerId,
  userId,
  onBack,
}: {
  playerId: string;
  userId: string;
  onBack: () => void;
}) {
  const { data: user } = useAdminUser(userId);
  const { data: userPlayers } = useAdminUserPlayers(userId);
  const playerRow = userPlayers?.players.find((p) => p.playerId === playerId);

  const portfolio = useAdminPlayerPortfolio(playerId);
  const updateCash = useAdminUpdateCash(playerId);
  const adjustHoldings = useAdminAdjustHoldings(playerId);
  const wipeHoldings = useAdminWipeHoldings(playerId);

  const [cashBalance, setCashBalance] = useState('');
  const [cashReason, setCashReason] = useState('');

  const [symbol, setSymbol] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [holdingsReason, setHoldingsReason] = useState('');

  const [showWipe, setShowWipe] = useState(false);

  async function submitCash() {
    const n = Number(cashBalance);
    if (!Number.isFinite(n) || n < 0) {
      toast({ title: 'Cash must be a non-negative number', variant: 'destructive' });
      return;
    }
    try {
      await updateCash.mutateAsync({
        cashBalance: n,
        ...(cashReason ? { reason: cashReason } : {}),
      });
      toast({ title: 'Cash updated', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Cash update failed');
    }
  }

  async function submitHoldings() {
    const delta = Number(quantityDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      toast({ title: 'Quantity delta must be a non-zero integer', variant: 'destructive' });
      return;
    }
    const cb = costBasis ? Number(costBasis) : undefined;
    if (cb !== undefined && (!Number.isFinite(cb) || cb <= 0)) {
      toast({ title: 'Cost basis must be a positive number', variant: 'destructive' });
      return;
    }
    try {
      await adjustHoldings.mutateAsync({
        symbol: symbol.toUpperCase(),
        quantityDelta: delta,
        ...(cb !== undefined && { costBasis: cb }),
        ...(holdingsReason ? { reason: holdingsReason } : {}),
      });
      toast({ title: 'Holdings adjusted', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Adjust failed');
    }
  }

  async function doWipe() {
    try {
      const res = await wipeHoldings.mutateAsync();
      toast({
        title: `Wiped ${res.holdingsWiped} holding${res.holdingsWiped === 1 ? '' : 's'}`,
        variant: 'success',
      });
      setShowWipe(false);
    } catch (err) {
      toastApiError(err, 'Wipe failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            <Link
              to={`/admin/users/${userId}`}
              className="underline hover:text-primary"
            >
              {user?.username ?? 'User'}
            </Link>{' '}
            · {playerRow?.gameName ?? 'Game'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {portfolio.data
              ? `Cash ${formatUSD(portfolio.data.cashBalance)} · Total ${formatUSD(portfolio.data.totalValue)}`
              : playerRow
                ? `Current cash: ${formatUSD(playerRow.cashBalance)}`
                : null}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← Change game
        </Button>
      </div>

      <PortfolioSummaryCard
        loading={portfolio.isLoading}
        isError={portfolio.isError}
        data={portfolio.data}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set cash balance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="cashBalance">New cash balance (absolute)</Label>
            <Input
              id="cashBalance"
              type="number"
              step="0.01"
              min="0"
              value={cashBalance}
              onChange={(e) => setCashBalance(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cashReason">Reason (optional)</Label>
            <Input
              id="cashReason"
              value={cashReason}
              onChange={(e) => setCashReason(e.target.value)}
            />
          </div>
          <Button onClick={submitCash} disabled={updateCash.isPending || !cashBalance}>
            {updateCash.isPending ? 'Saving…' : 'Set cash'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adjust holdings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
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
              <Label htmlFor="quantityDelta">Quantity delta</Label>
              <Input
                id="quantityDelta"
                type="number"
                step="1"
                value={quantityDelta}
                onChange={(e) => setQuantityDelta(e.target.value)}
                placeholder="positive=add, negative=remove"
              />
            </div>
            <div>
              <Label htmlFor="costBasis">Cost basis (required on add)</Label>
              <Input
                id="costBasis"
                type="number"
                step="0.01"
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="holdingsReason">Reason (optional)</Label>
            <Input
              id="holdingsReason"
              value={holdingsReason}
              onChange={(e) => setHoldingsReason(e.target.value)}
            />
          </div>
          <Button
            onClick={submitHoldings}
            disabled={adjustHoldings.isPending || !symbol || !quantityDelta}
          >
            {adjustHoldings.isPending ? 'Saving…' : 'Apply'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Wipe holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setShowWipe(true)}>
            Wipe all holdings
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showWipe}
        onOpenChange={setShowWipe}
        title="Wipe all holdings?"
        description="Removes every position for this player. Cash balance is not changed."
        confirmLabel="Wipe"
        destructive
        onConfirm={doWipe}
      />
    </div>
  );
}

function PortfolioSummaryCard({
  loading,
  isError,
  data,
}: {
  loading: boolean;
  isError: boolean;
  data: PortfolioResponse | undefined;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Current portfolio</CardTitle>
          {data && (
            <div className="text-sm">
              <span className="text-muted-foreground">Total </span>
              <span className="font-semibold">{formatUSD(data.totalValue)}</span>
              {data.reservedValue > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (incl. {formatUSD(data.reservedValue)} reserved)
                </span>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && <Skeleton className="h-24 w-full" />}
        {isError && (
          <p className="text-sm text-destructive">Failed to load portfolio.</p>
        )}
        {data && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Cash </span>
              <span className="font-medium">{formatUSD(data.cashBalance)}</span>
            </div>
            {data.holdings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No holdings.</p>
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
                  {data.holdings.map((h) => (
                    <TableRow key={h.symbol}>
                      <TableCell className="font-medium">{h.symbol}</TableCell>
                      <TableCell className="text-right">{h.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatUSD(h.avgCostBasis)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatUSD(h.currentPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatUSD(h.marketValue)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          h.unrealizedPnL > 0 && 'text-success',
                          h.unrealizedPnL < 0 && 'text-destructive',
                        )}
                      >
                        {formatUSD(h.unrealizedPnL)}{' '}
                        <span className="text-xs">({formatPct(h.unrealizedPnLPercent)})</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

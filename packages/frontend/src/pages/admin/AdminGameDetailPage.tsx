import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useAdminGame,
  useAdminUpdateGame,
  useAdminTransferGameOwner,
  useAdminSetGameStatus,
  useAdminResetGame,
  useAdminDeleteGame,
  useAdminCancelWorkingOrders,
  useAdminAddPlayer,
  useAdminRemovePlayer,
  useAdminGamePlayers,
} from '@/api/admin/games';
import { useAdminUser } from '@/api/admin/users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { toastApiError } from '@/lib/toastApiError';

const editSchema = z.object({
  name: z.string().min(1).max(80),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  startingBalance: z.coerce.number().positive(),
  allowShortSelling: z.boolean(),
  allowLimitOrders: z.boolean(),
  allowStopOrders: z.boolean(),
  allowBracketOrders: z.boolean(),
  allowGTC: z.boolean(),
});
type EditValues = z.infer<typeof editSchema>;

function isoToLocalDateTime(iso: string): string {
  // YYYY-MM-DDTHH:mm for <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminGameDetailPage() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const { data: game, isLoading, isError } = useAdminGame(gameId);

  const updateGame = useAdminUpdateGame(gameId);
  const transferOwner = useAdminTransferGameOwner(gameId);
  const setStatus = useAdminSetGameStatus(gameId);
  const resetGame = useAdminResetGame(gameId);
  const deleteGame = useAdminDeleteGame(gameId);
  const cancelOrders = useAdminCancelWorkingOrders(gameId);
  const addPlayer = useAdminAddPlayer(gameId);
  const removePlayer = useAdminRemovePlayer(gameId);
  const { data: playersData } = useAdminGamePlayers(gameId);
  const { data: owner } = useAdminUser(game?.createdBy ?? '');

  const [showTransfer, setShowTransfer] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetForce, setResetForce] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteForce, setDeleteForce] = useState(false);
  const [showCancelOrders, setShowCancelOrders] = useState(false);
  const [addPlayerUserId, setAddPlayerUserId] = useState('');
  const [removePlayerId, setRemovePlayerId] = useState<string | null>(null);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: '',
      startDate: '',
      endDate: '',
      startingBalance: 100000,
      allowShortSelling: false,
      allowLimitOrders: false,
      allowStopOrders: false,
      allowBracketOrders: false,
      allowGTC: false,
    },
  });

  useEffect(() => {
    if (game) {
      form.reset({
        name: game.name,
        startDate: isoToLocalDateTime(game.startDate),
        endDate: isoToLocalDateTime(game.endDate),
        startingBalance: game.startingBalance,
        allowShortSelling: game.allowShortSelling,
        allowLimitOrders: game.allowLimitOrders,
        allowStopOrders: game.allowStopOrders,
        allowBracketOrders: game.allowBracketOrders,
        allowGTC: game.allowGTC,
      });
    }
    // Re-sync on every refetch so out-of-band updates to the same game
    // land in the form.
  }, [game, form]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !game) return <p className="text-sm text-destructive">Game not found.</p>;

  const submitEdit = form.handleSubmit(async (values) => {
    try {
      await updateGame.mutateAsync({
        name: values.name,
        startDate: new Date(values.startDate).toISOString(),
        endDate: new Date(values.endDate).toISOString(),
        startingBalance: values.startingBalance,
        allowShortSelling: values.allowShortSelling,
        allowLimitOrders: values.allowLimitOrders,
        allowStopOrders: values.allowStopOrders,
        allowBracketOrders: values.allowBracketOrders,
        allowGTC: values.allowGTC,
      });
      toast({ title: 'Game updated', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Update failed');
    }
  });

  async function changeStatus(next: 'pending' | 'active' | 'ended') {
    try {
      await setStatus.mutateAsync({ status: next });
      toast({ title: `Status set to ${next}`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Status change failed');
    }
  }

  async function doTransfer() {
    try {
      await transferOwner.mutateAsync({ newOwnerId });
      toast({ title: 'Owner transferred', variant: 'success' });
      setShowTransfer(false);
      setNewOwnerId('');
    } catch (err) {
      toastApiError(err, 'Transfer failed');
    }
  }

  async function doReset() {
    try {
      await resetGame.mutateAsync({ force: resetForce });
      toast({ title: 'Game reset', variant: 'success' });
      setShowReset(false);
    } catch (err) {
      toastApiError(err, 'Reset failed');
    }
  }

  async function doDelete() {
    try {
      await deleteGame.mutateAsync({ force: deleteForce });
      toast({ title: 'Game deleted', variant: 'success' });
      navigate('/admin/games');
    } catch (err) {
      toastApiError(err, 'Delete failed');
      setShowDelete(false);
    }
  }

  async function doCancelOrders() {
    try {
      const res = await cancelOrders.mutateAsync();
      toast({
        title: `Cancelled ${res.cancelled} working order${res.cancelled === 1 ? '' : 's'}`,
        variant: 'success',
      });
      setShowCancelOrders(false);
    } catch (err) {
      toastApiError(err, 'Cancel failed');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/admin/games" className="text-sm text-muted-foreground hover:underline">
          ← All games
        </Link>
        <h1 className="text-2xl font-semibold">{game.name}</h1>
        <p className="text-sm text-muted-foreground">
          Status: {game.status} · {game.playerCount} players · owner{' '}
          <Link to={`/admin/users/${game.createdBy}`} className="underline hover:text-foreground">
            {owner?.username ?? game.createdBy}
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register('name')} />
            </div>
            <div>
              <Label htmlFor="startDate">Start</Label>
              <Input id="startDate" type="datetime-local" {...form.register('startDate')} />
            </div>
            <div>
              <Label htmlFor="endDate">End</Label>
              <Input id="endDate" type="datetime-local" {...form.register('endDate')} />
            </div>
            <div>
              <Label htmlFor="startingBalance">Starting balance</Label>
              <Input
                id="startingBalance"
                type="number"
                step="0.01"
                {...form.register('startingBalance')}
              />
            </div>
            <div className="sm:col-span-2 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" {...form.register('allowShortSelling')} />
                Allow short selling
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" {...form.register('allowLimitOrders')} />
                Allow limit orders
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" {...form.register('allowStopOrders')} />
                Allow stop orders
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" {...form.register('allowBracketOrders')} />
                Allow bracket orders
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" {...form.register('allowGTC')} />
                Allow GTC orders
              </label>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={updateGame.isPending}>
                {updateGame.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {(['pending', 'active', 'ended'] as const).map((s) => (
            <Button
              key={s}
              variant={game.status === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => changeStatus(s)}
              disabled={setStatus.isPending}
            >
              {s}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Owner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Current:{' '}
            <Link
              to={`/admin/users/${game.createdBy}`}
              className="font-medium text-foreground underline hover:text-primary"
            >
              {owner?.username ?? game.createdBy}
            </Link>
          </p>
          <Button variant="outline" onClick={() => setShowTransfer(true)}>
            Transfer ownership…
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Players ({playersData?.players.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="User ID to add"
              value={addPlayerUserId}
              onChange={(e) => setAddPlayerUserId(e.target.value)}
            />
            <Button
              onClick={async () => {
                try {
                  await addPlayer.mutateAsync({ userId: addPlayerUserId });
                  toast({ title: 'Player added', variant: 'success' });
                  setAddPlayerUserId('');
                } catch (err) {
                  toastApiError(err, 'Add failed');
                }
              }}
              disabled={!addPlayerUserId || addPlayer.isPending}
            >
              Add
            </Button>
          </div>
          {playersData && playersData.players.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {playersData.players.map((p) => (
                <li key={p.playerId} className="flex items-center justify-between p-2">
                  <span>
                    {p.username}{' '}
                    <span className="text-xs text-muted-foreground">({p.playerId})</span>
                  </span>
                  <div className="flex gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/portfolios?userId=${p.userId}&playerId=${p.playerId}`}>
                        Edit
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemovePlayerId(p.playerId)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Working orders</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShowCancelOrders(true)}>
            Cancel all working orders
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowReset(true)}>
            Reset game data
          </Button>
          <Button variant="destructive" onClick={() => setShowDelete(true)}>
            Delete game
          </Button>
        </CardContent>
      </Card>

      <TransferOwnerDialog
        open={showTransfer}
        onOpenChange={setShowTransfer}
        value={newOwnerId}
        onChange={setNewOwnerId}
        onConfirm={doTransfer}
        pending={transferOwner.isPending}
      />

      <ConfirmDialog
        open={showReset}
        onOpenChange={setShowReset}
        title="Reset game data?"
        description="Wipes all trades and portfolios; restores starting cash for every player."
        confirmLabel="Reset"
        destructive
        toggle={{
          label: 'Force (also reset if trades exist)',
          value: resetForce,
          onChange: setResetForce,
        }}
        onConfirm={doReset}
      />

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title={`Delete ${game.name}?`}
        description="Cascades to all players, trades, and portfolios."
        confirmLabel="Delete"
        destructive
        toggle={{
          label: 'Force (also delete if players exist)',
          value: deleteForce,
          onChange: setDeleteForce,
        }}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={!!removePlayerId}
        onOpenChange={(v) => !v && setRemovePlayerId(null)}
        title="Remove player?"
        description="Cascades to their trades and holdings in this game."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removePlayerId) return;
          try {
            await removePlayer.mutateAsync(removePlayerId);
            toast({ title: 'Player removed', variant: 'success' });
            setRemovePlayerId(null);
          } catch (err) {
            toastApiError(err, 'Remove failed');
          }
        }}
      />

      <ConfirmDialog
        open={showCancelOrders}
        onOpenChange={setShowCancelOrders}
        title="Cancel all working orders?"
        description="Open buy/sell limit, stop, and bracket orders will be cancelled. Pending buys refund reserved cash."
        confirmLabel="Cancel orders"
        destructive
        onConfirm={doCancelOrders}
      />
    </div>
  );
}

// Inline component since transfer needs a text input the ConfirmDialog doesn't provide.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function TransferOwnerDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            The new owner is auto-enrolled as a player if they aren't already.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="newOwnerId">New owner user ID</Label>
          <Input
            id="newOwnerId"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="user UUID"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending || !value}>
            {pending ? 'Transferring…' : 'Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

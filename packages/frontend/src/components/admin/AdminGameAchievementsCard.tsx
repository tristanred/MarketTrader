import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { toastApiError } from '@/lib/toastApiError';
import { useAdminGamePlayers } from '@/api/admin/games';
import {
  useAdminGameAchievements,
  useAdminGlobalAchievements,
  useAdminResetAchievement,
  useAdminSetAchievementProgress,
  useAdminSetGameAchievementEnabled,
  useAdminUnlockAchievement,
} from '@/api/admin/achievements';
import type {
  AchievementDefinitionDTO,
  AdminAchievementProgressRow,
} from '@markettrader/shared';

interface Props {
  gameId: string;
}

interface PlayerLite {
  gamePlayerId: string;
  username: string;
}

/**
 * Admin card on the per-game admin page. Lets an operator toggle per-game
 * achievement availability and force-unlock / reset / set-progress for any
 * player in the game. Force-unlock and set-progress crossing the target
 * fire a WS broadcast so the player sees the toast in real time.
 */
export function AdminGameAchievementsCard({ gameId }: Props) {
  const view = useAdminGameAchievements(gameId);
  const globalView = useAdminGlobalAchievements();
  const playersQuery = useAdminGamePlayers(gameId);

  const players: PlayerLite[] = useMemo(() => {
    const rows = playersQuery.data?.players ?? [];
    return rows
      .map((p) => ({ gamePlayerId: p.playerId, username: p.username }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [playersQuery.data]);

  const globalEnabledByKey = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const d of globalView.data?.definitions ?? []) m.set(d.key, d.enabled);
    return m;
  }, [globalView.data]);

  if (view.isLoading || playersQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Achievements</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (view.isError || !view.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Achievements</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Failed to load achievements.</p>
        </CardContent>
      </Card>
    );
  }

  const { definitions, rows } = view.data;
  const enabledDefs = definitions.filter((d) => d.enabled);
  const orphans = rows.filter((r) => r.orphaned);

  // gamePlayerId → key → row
  const rowsByPlayer = new Map<string, Map<string, AdminAchievementProgressRow>>();
  for (const r of rows) {
    if (r.orphaned) continue;
    const byKey = rowsByPlayer.get(r.gamePlayerId) ?? new Map();
    byKey.set(r.achievementKey, r);
    rowsByPlayer.set(r.gamePlayerId, byKey);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Achievements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PerGameToggles
          gameId={gameId}
          definitions={definitions}
          globalEnabledByKey={globalEnabledByKey}
        />

        {players.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players in this game yet.</p>
        ) : (
          <div className="space-y-2">
            {players.map((p, idx) => (
              <PlayerAccordion
                key={p.gamePlayerId}
                gameId={gameId}
                player={p}
                enabledDefs={enabledDefs}
                rowsByKey={rowsByPlayer.get(p.gamePlayerId) ?? new Map()}
                defaultOpen={idx === 0}
              />
            ))}
          </div>
        )}

        {orphans.length > 0 && (
          <OrphansSection orphans={orphans} />
        )}
      </CardContent>
    </Card>
  );
}

function PerGameToggles({
  gameId,
  definitions,
  globalEnabledByKey,
}: {
  gameId: string;
  definitions: AchievementDefinitionDTO[];
  globalEnabledByKey: Map<string, boolean>;
}) {
  const setEnabled = useAdminSetGameAchievementEnabled(gameId);

  async function toggle(key: string, enabled: boolean) {
    try {
      await setEnabled.mutateAsync({ key, enabled });
      toast({ title: `${enabled ? 'Enabled' : 'Disabled'} for this game`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Toggle failed');
    }
  }

  return (
    <details className="rounded border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Per-game toggles ({definitions.length})
      </summary>
      <div className="grid grid-cols-1 gap-1 px-3 pb-3 pt-2 sm:grid-cols-2">
        {definitions
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => {
            const globallyEnabled = globalEnabledByKey.get(d.key) ?? true;
            const disabled = !globallyEnabled;
            return (
              <label
                key={d.key}
                className="flex items-center gap-2 text-sm"
                title={disabled ? 'Disabled globally — manage on the system page.' : undefined}
              >
                <input
                  type="checkbox"
                  checked={d.enabled && globallyEnabled}
                  disabled={disabled || setEnabled.isPending}
                  onChange={(e) => void toggle(d.key, e.target.checked)}
                />
                <span className={disabled ? 'text-muted-foreground' : ''}>{d.name}</span>
              </label>
            );
          })}
      </div>
    </details>
  );
}

function PlayerAccordion({
  gameId,
  player,
  enabledDefs,
  rowsByKey,
  defaultOpen,
}: {
  gameId: string;
  player: PlayerLite;
  enabledDefs: AchievementDefinitionDTO[];
  rowsByKey: Map<string, AdminAchievementProgressRow>;
  defaultOpen: boolean;
}) {
  const unlockedCount = enabledDefs.filter((d) => rowsByKey.get(d.key)?.unlockedAt).length;

  return (
    <details className="rounded border border-border" open={defaultOpen}>
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <span className="font-medium">{player.username}</span>
        <span className="ml-2 text-muted-foreground">
          {unlockedCount} / {enabledDefs.length} unlocked
        </span>
      </summary>
      <div className="overflow-x-auto px-3 pb-3 pt-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="py-1 pr-2">Achievement</th>
              <th className="py-1 pr-2">Progress</th>
              <th className="py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {enabledDefs
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((d) => (
                <AchievementRow
                  key={d.key}
                  gameId={gameId}
                  player={player}
                  def={d}
                  row={rowsByKey.get(d.key) ?? null}
                />
              ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AchievementRow({
  gameId,
  player,
  def,
  row,
}: {
  gameId: string;
  player: PlayerLite;
  def: AchievementDefinitionDTO;
  row: AdminAchievementProgressRow | null;
}) {
  const unlock = useAdminUnlockAchievement(gameId);
  const reset = useAdminResetAchievement(gameId);
  const setProgress = useAdminSetAchievementProgress(gameId);

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressInput, setProgressInput] = useState('');

  const isUnlocked = Boolean(row?.unlockedAt);
  const progress = row?.progress ?? 0;
  const progressLabel = isUnlocked
    ? `Unlocked ${formatTimestamp(row!.unlockedAt!)}`
    : `${progress} / ${def.target}`;

  async function confirmUnlock() {
    try {
      await unlock.mutateAsync({ gamePlayerId: player.gamePlayerId, key: def.key });
      toast({ title: `${def.name} unlocked for ${player.username}`, variant: 'success' });
      setUnlockOpen(false);
    } catch (err) {
      toastApiError(err, 'Unlock failed');
    }
  }

  async function confirmReset() {
    try {
      await reset.mutateAsync({ gamePlayerId: player.gamePlayerId, key: def.key });
      toast({ title: `${def.name} reset for ${player.username}`, variant: 'success' });
      setResetOpen(false);
    } catch (err) {
      toastApiError(err, 'Reset failed');
    }
  }

  async function submitProgress() {
    const n = Number(progressInput);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast({ title: 'Enter a non-negative integer', variant: 'destructive' });
      return;
    }
    try {
      await setProgress.mutateAsync({
        gamePlayerId: player.gamePlayerId,
        key: def.key,
        progress: n,
      });
      toast({ title: `${def.name}: progress set to ${n}`, variant: 'success' });
      setEditingProgress(false);
    } catch (err) {
      toastApiError(err, 'Set progress failed');
    }
  }

  function startEditingProgress() {
    setProgressInput(String(progress));
    setEditingProgress(true);
  }

  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-2">{def.name}</td>
      <td className="py-1.5 pr-2 font-mono text-xs tabular-nums">
        {editingProgress ? (
          <span className="inline-flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={1}
              value={progressInput}
              onChange={(e) => setProgressInput(e.target.value)}
              className="h-7 w-20 px-2 py-0 text-xs"
              autoFocus
            />
            <Button size="sm" className="h-7" onClick={() => void submitProgress()} disabled={setProgress.isPending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setEditingProgress(false)}
              disabled={setProgress.isPending}
            >
              Cancel
            </Button>
          </span>
        ) : (
          progressLabel
        )}
      </td>
      <td className="py-1.5">
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={isUnlocked || unlock.isPending}
            onClick={() => setUnlockOpen(true)}
          >
            Unlock
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={(progress === 0 && !isUnlocked) || reset.isPending}
            onClick={() => setResetOpen(true)}
          >
            Reset
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={editingProgress}
            onClick={startEditingProgress}
          >
            Set…
          </Button>
        </div>
        <ConfirmDialog
          open={unlockOpen}
          onOpenChange={setUnlockOpen}
          title={`Force-unlock ${def.name}?`}
          description={`This will mark "${def.name}" as unlocked for ${player.username} and broadcast a toast to them.`}
          confirmLabel="Unlock"
          onConfirm={confirmUnlock}
        />
        <ConfirmDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title={`Reset ${def.name}?`}
          description={`Resets progress to 0 and clears the unlock timestamp for ${player.username}.`}
          confirmLabel="Reset"
          destructive
          onConfirm={confirmReset}
        />
      </td>
    </tr>
  );
}

function OrphansSection({ orphans }: { orphans: AdminAchievementProgressRow[] }) {
  return (
    <details className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Orphaned rows ({orphans.length})
      </summary>
      <div className="px-3 pb-3 pt-2 text-xs text-muted-foreground">
        <p>
          These progress rows reference achievement keys that are no longer registered with the
          engine. They are excluded from player-facing views. Clean them up via the database if
          needed.
        </p>
        <ul className="mt-2 list-disc pl-5">
          {orphans.map((o) => (
            <li key={`${o.gamePlayerId}-${o.achievementKey}`} className="font-mono">
              {o.achievementKey} · player {o.gamePlayerId.slice(0, 8)}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

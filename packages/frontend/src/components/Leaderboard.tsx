import { useGame } from '@/api/games';
import { useLiveStore } from '@/stores/liveStore';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUSD, cn } from '@/lib/utils';

export function Leaderboard({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const liveBoard = useLiveStore((s) => s.leaderboard);
  const userId = useAuthStore((s) => s.user?.id);

  const board = liveBoard ?? game.data?.leaderboard ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaderboard</CardTitle>
      </CardHeader>
      <CardContent>
        {!board && game.isLoading && <Skeleton className="h-32 w-full" />}
        {board && board.length === 0 && (
          <p className="text-sm text-muted-foreground">No players yet.</p>
        )}
        {board && board.length > 0 && (
          <ol className="space-y-1">
            {board.map((e) => (
              <li
                key={e.playerId}
                className={cn(
                  'flex items-baseline justify-between rounded px-2 py-1.5 text-sm',
                  e.playerId === userId && 'bg-accent text-accent-foreground',
                )}
              >
                <span>
                  <span className="inline-block w-6 text-muted-foreground">{e.rank}.</span>
                  <span className="font-medium">{e.username}</span>
                </span>
                <span className="tabular-nums">{formatUSD(e.totalValue)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGame } from '@/api/games';
import { useLiveStore } from '@/stores/liveStore';
import { toast } from '@/components/ui/toast';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function AboutThisGameCard({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const liveBoard = useLiveStore((s) => s.leaderboard);

  const creatorName = useMemo(() => {
    const board = liveBoard ?? game.data?.leaderboard ?? null;
    if (!board || !game.data) return null;
    return board.find((e) => e.playerId === game.data?.createdBy)?.username ?? null;
  }, [liveBoard, game.data]);

  const playerCount = (liveBoard ?? game.data?.leaderboard ?? []).length;

  if (!game.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>About this game</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const handleInvite = async () => {
    const url = `${window.location.origin}/games/${gameId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Invite link copied', description: url, variant: 'success' });
    } catch {
      toast({ title: 'Could not copy link', description: url, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="uppercase tracking-wide text-xs text-muted-foreground">
          About this game
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          <div>
            <div className="text-xs text-muted-foreground">Start Date</div>
            <div className="mt-0.5 text-sm font-medium">{formatDate(game.data.startDate)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">End Date</div>
            <div className="mt-0.5 text-sm font-medium">{formatDate(game.data.endDate)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Players</div>
            <div className="mt-0.5 text-sm font-medium tabular-nums">{playerCount}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Created By</div>
            <div className="mt-0.5 text-sm font-medium">{creatorName ?? '—'}</div>
          </div>
        </div>
        <div className="flex justify-center">
          <Button onClick={handleInvite} className="uppercase tracking-wider">
            Invite players
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

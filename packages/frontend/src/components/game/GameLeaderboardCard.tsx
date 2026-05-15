import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useGame } from '@/api/games';
import { useTradeHistory } from '@/api/trades';
import { useLiveStore } from '@/stores/liveStore';
import { useAuthStore } from '@/stores/authStore';
import { formatPct, formatUSD, cn } from '@/lib/utils';
import { Trophy } from 'lucide-react';

export function GameLeaderboardCard({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const liveBoard = useLiveStore((s) => s.leaderboard);
  const myTrades = useTradeHistory(gameId);
  const user = useAuthStore((s) => s.user);

  const board = liveBoard ?? game.data?.leaderboard ?? null;
  const startingBalance = game.data?.startingBalance;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="uppercase tracking-wide text-xs text-muted-foreground">
          Game leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!board && <Skeleton className="h-24 w-full" />}
        {board && board.length === 0 && (
          <p className="text-sm text-muted-foreground">No players yet.</p>
        )}
        {board && board.length > 0 && startingBalance !== undefined && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Net Worth</TableHead>
                <TableHead className="text-right">Today's Gains</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Total Returns</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.map((e) => {
                const returns = startingBalance !== 0
                  ? ((e.totalValue - startingBalance) / startingBalance) * 100
                  : 0;
                const totalGain = e.totalValue - startingBalance;
                const isMe = e.playerId === user?.id;
                return (
                  <TableRow key={e.playerId}>
                    <TableCell className="text-muted-foreground tabular-nums">{e.rank}</TableCell>
                    <TableCell>
                      <span className="font-medium underline-offset-4 hover:underline">
                        {e.username}
                      </span>
                      {isMe && (
                        <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                          Me
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUSD(e.totalValue)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isMe && myTrades.data ? myTrades.data.length : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        totalGain >= 0.005 && 'text-green-600 dark:text-green-400',
                        totalGain <= -0.005 && 'text-destructive',
                      )}
                    >
                      {formatUSD(totalGain)} ({formatPct(returns)})
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

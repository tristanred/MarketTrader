import { Link } from 'react-router-dom';
import { useGames } from '@/api/games';
import { CreateGameDialog } from '@/components/CreateGameDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUSD, cn } from '@/lib/utils';
import type { GameStatus } from '@markettrader/shared';

const statusStyles: Record<GameStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  active: 'bg-success text-success-foreground',
  ended: 'bg-destructive/10 text-destructive',
};

export function GamesListPage() {
  const games = useGames();

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Your games</h1>
          <CreateGameDialog />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All games</CardTitle>
            <CardDescription>Tournaments you've joined.</CardDescription>
          </CardHeader>
          <CardContent>
            {games.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {games.isError && <p className="text-sm text-destructive">Couldn't load games.</p>}
            {games.data && games.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No games yet. Create one to get started.</p>
            )}
            {games.data && games.data.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Starting balance</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {games.data.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>
                        <Link to={`/games/${g.id}`} className="font-medium underline-offset-4 hover:underline">
                          {g.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className={cn('rounded px-2 py-1 text-xs font-medium', statusStyles[g.status])}>
                          {g.status}
                        </span>
                      </TableCell>
                      <TableCell>{formatUSD(g.startingBalance)}</TableCell>
                      <TableCell>{new Date(g.startDate).toLocaleString()}</TableCell>
                      <TableCell>{new Date(g.endDate).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
    </div>
  );
}

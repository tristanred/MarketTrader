import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminGames, type AdminListGamesQuery } from '@/api/admin/games';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<'pending' | 'active' | 'ended', string> = {
  pending: 'bg-muted text-muted-foreground',
  active: 'bg-success/20 text-success-foreground',
  ended: 'bg-destructive/10 text-destructive',
};

export function AdminGamesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'active' | 'ended'>('all');
  const [offset, setOffset] = useState(0);

  const query: AdminListGamesQuery = {
    limit: PAGE_SIZE,
    offset,
    ...(q ? { q } : {}),
    ...(status !== 'all' ? { status } : {}),
  };
  const { data, isLoading, isError } = useAdminGames(query);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Games</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setOffset(0);
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
        </select>
        {data && <span className="ml-auto text-sm text-muted-foreground">{data.total} total</span>}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {isError && <p className="text-sm text-destructive">Failed to load games.</p>}

      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Players</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.games.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No games match.
                  </TableCell>
                </TableRow>
              )}
              {data.games.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[g.status]}`}
                    >
                      {g.status}
                    </span>
                  </TableCell>
                  <TableCell>{g.playerCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(g.startDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(g.endDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/games/${g.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

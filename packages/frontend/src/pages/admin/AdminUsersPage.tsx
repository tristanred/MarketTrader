import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminUsers, type AdminListUsersQuery } from '@/api/admin/users';
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

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'createdAt' | 'username'>('createdAt');
  const [offset, setOffset] = useState(0);

  const query: AdminListUsersQuery = {
    sort,
    limit: PAGE_SIZE,
    offset,
    ...(q ? { q } : {}),
  };
  const { data, isLoading, isError } = useAdminUsers(query);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search username…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          className="max-w-xs"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'createdAt' | 'username')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="createdAt">Sort: newest</option>
          <option value="username">Sort: username</option>
        </select>
        {data && (
          <span className="ml-auto text-sm text-muted-foreground">
            {data.total} total
          </span>
        )}
      </div>

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
                <TableHead>Groups</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No users match.
                  </TableCell>
                </TableRow>
              )}
              {data.users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>
                    {u.disabled ? (
                      <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                        Disabled
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Active</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.groups.map((g) => (
                        <span
                          key={g}
                          className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/users/${u.id}`}>Open</Link>
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

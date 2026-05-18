import { Fragment, useState } from 'react';
import type { AdminAuditTargetType } from '@markettrader/shared';
import { useAdminAudit, type AdminAuditQuery } from '@/api/admin/audit';
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

const PAGE_SIZE = 50;

// Parse a datetime-local input value. Returns the ISO string when the value
// is a valid date, or undefined when blank/invalid — so an in-progress or
// garbage entry doesn't throw RangeError out of .toISOString().
function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
const TARGET_TYPES: ('all' | AdminAuditTargetType)[] = [
  'all',
  'user',
  'game',
  'trade',
  'portfolio',
  'system',
];

export function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState<'all' | AdminAuditTargetType>('all');
  const [targetId, setTargetId] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sinceIso = toIsoOrUndefined(since);
  const untilIso = toIsoOrUndefined(until);
  const query: AdminAuditQuery = {
    limit: PAGE_SIZE,
    offset,
    ...(action ? { action } : {}),
    ...(targetType !== 'all' ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
    ...(adminUserId ? { adminUserId } : {}),
    ...(sinceIso ? { since: sinceIso } : {}),
    ...(untilIso ? { until: untilIso } : {}),
  };
  const { data, isLoading, isError } = useAdminAudit(query);

  function resetFilters() {
    setAction('');
    setTargetType('all');
    setTargetId('');
    setAdminUserId('');
    setSince('');
    setUntil('');
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input placeholder="Action" value={action} onChange={(e) => setAction(e.target.value)} />
        <select
          value={targetType}
          onChange={(e) => setTargetType(e.target.value as typeof targetType)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All target types' : t}
            </option>
          ))}
        </select>
        <Input
          placeholder="Target ID"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        />
        <Input
          placeholder="Admin user ID"
          value={adminUserId}
          onChange={(e) => setAdminUserId(e.target.value)}
        />
        <Input
          type="datetime-local"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          placeholder="Since"
        />
        <Input
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          placeholder="Until"
        />
        <Button variant="outline" onClick={resetFilters}>
          Reset filters
        </Button>
        {data && (
          <span className="self-center text-right text-sm text-muted-foreground">
            {data.total} entries
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {isError && <p className="text-sm text-destructive">Failed to load audit log.</p>}

      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No entries.
                  </TableCell>
                </TableRow>
              )}
              {data.entries.map((e) => {
                const isOpen = expanded === e.id;
                return (
                  <Fragment key={e.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : e.id)}
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {e.adminUsername ?? e.adminUserId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.action}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.targetType}
                        {e.targetId ? `:${e.targetId}` : ''}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {isOpen ? '▼' : '▸'}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <div className="grid gap-2 sm:grid-cols-3">
                            <JsonBlock title="Before" data={e.before} />
                            <JsonBlock title="After" data={e.after} />
                            <JsonBlock title="Metadata" data={e.metadata} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
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

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <pre className="overflow-x-auto rounded bg-background p-2 text-xs">
        {data === null || data === undefined ? <span className="text-muted-foreground">—</span> : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

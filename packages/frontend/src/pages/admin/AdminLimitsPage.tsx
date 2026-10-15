import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminLimitOverrideEntry } from '@markettrader/shared';
import {
  useAdminClearUserLimit,
  useAdminLimitOverrides,
  useAdminLimitPolicy,
  useAdminTopConsumers,
  type TopMetric,
  type TopWindow,
} from '@/api/admin/limits';
import { Button } from '@/components/ui/button';
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
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { PrivilegedIpBanner } from '@/components/admin/PrivilegedIpBanner';
import { LIMIT_LABELS, limitLabel } from '@/lib/limitLabels';
import { toastApiError } from '@/lib/toastApiError';
import { cn } from '@/lib/utils';

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-md border border-hairline-strong p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium',
            o.value === value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const METRICS = [
  { value: 'requests', label: 'Requests' },
  { value: 'denials', label: 'Denials' },
] as const satisfies readonly { value: TopMetric; label: string }[];

const WINDOWS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
] as const satisfies readonly { value: TopWindow; label: string }[];

/** Who is generating load, which overrides are in force, and the policy every limit is resolved under. */
export function AdminLimitsPage() {
  const [range, setRange] = useState<TopWindow>('24h');
  const [metric, setMetric] = useState<TopMetric>('requests');
  const top = useAdminTopConsumers(range, metric);
  const overrides = useAdminLimitOverrides();
  const policy = useAdminLimitPolicy();
  const clearLimit = useAdminClearUserLimit();
  const [clearing, setClearing] = useState<AdminLimitOverrideEntry | null>(null);

  async function confirmClear() {
    if (!clearing) return;
    try {
      await clearLimit.mutateAsync({ userId: clearing.userId, key: clearing.key });
      toast({ title: `Override cleared for ${clearing.username}`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Clear failed');
    } finally {
      setClearing(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Limits</h1>
        <p className="text-sm text-muted-foreground">
          Global values are edited in Configuration; per-user overrides on each user&apos;s page.
          Admins are never limited.
        </p>
      </div>

      <PrivilegedIpBanner />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Top consumers</CardTitle>
          <div className="flex gap-2">
            <Toggle label="Metric" value={metric} options={METRICS} onChange={setMetric} />
            <Toggle label="Window" value={range} options={WINDOWS} onChange={setRange} />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {top.isLoading && <Skeleton className="h-32 w-full" />}
          {top.isError && <p className="text-sm text-destructive">Could not load usage.</p>}
          {top.data && (
            <Table aria-label="Top consumers">
              <TableHeader>
                <TableRow>
                  <TableHead>User / IP</TableHead>
                  <TableHead className="text-right">
                    {metric === 'requests' ? 'Requests' : 'Denials'}
                  </TableHead>
                  <TableHead>{metric === 'requests' ? 'Top route' : 'Top limit'}</TableHead>
                  <TableHead>Signals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.data.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-xs text-muted-foreground">
                      Nothing recorded in this window.
                    </TableCell>
                  </TableRow>
                )}
                {top.data.rows.map((r) => (
                  <TableRow key={`${r.subjectType}:${r.subjectId}`}>
                    <TableCell>
                      {r.subjectType === 'user' ? (
                        <Link to={`/admin/users/${r.subjectId}`} className="hover:underline">
                          {r.username ?? r.subjectId}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{r.subjectId}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.count}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.top === null ? '—' : metric === 'denials' ? limitLabel(r.top) : r.top}
                    </TableCell>
                    <TableCell>
                      {r.sharedRegistrationIpCount > 0 && (
                        <span
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400"
                          title="Other accounts registered from the same IP"
                        >
                          ⚠ {r.sharedRegistrationIpCount} shared IP
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active overrides</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overrides.isLoading && <Skeleton className="h-24 w-full" />}
          {overrides.isError && (
            <p className="text-sm text-destructive">Could not load overrides.</p>
          )}
          {overrides.data && (
            <Table aria-label="Active overrides">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs text-muted-foreground">
                      No overrides — every user is on the global limits.
                    </TableCell>
                  </TableRow>
                )}
                {overrides.data.map((o) => (
                  <TableRow key={`${o.userId}:${o.key}`}>
                    <TableCell>
                      <Link to={`/admin/users/${o.userId}`} className="hover:underline">
                        {o.username}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{LIMIT_LABELS[o.key]}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{o.value}</TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      {o.note ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.updatedAt).toLocaleString()}
                      {o.updatedByUsername && ` · ${o.updatedByUsername}`}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Clear override for ${o.username} ${LIMIT_LABELS[o.key]}`}
                        onClick={() => setClearing(o)}
                      >
                        Clear
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {policy.data && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Enforcement</dt>
                <dd>
                  {policy.data.enabled
                    ? 'On'
                    : 'Off — per-user limits are lifted; per-IP route limits stay'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Account maturity</dt>
                <dd>{policy.data.maturityDays} days</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Probation</dt>
                <dd>{policy.data.probationPercent}% of each limit</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Privileged multiplier</dt>
                <dd>×{policy.data.privilegedMultiplier}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Privileged IPs</dt>
                <dd className="font-mono text-xs">
                  {policy.data.privilegedCidrs.length === 0
                    ? 'None'
                    : policy.data.privilegedCidrs.map((c) => <div key={c}>{c}</div>)}
                </dd>
              </div>
            </dl>
          )}
          <Link to="/admin/config" className="text-sm hover:underline">
            Edit in Configuration →
          </Link>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => !open && setClearing(null)}
        title={`Clear ${clearing?.username ?? ''}'s ${clearing ? LIMIT_LABELS[clearing.key] : ''} override?`}
        description="The global value applies to this user again from the next request."
        confirmLabel="Clear override"
        onConfirm={confirmClear}
      />
    </div>
  );
}

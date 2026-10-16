import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminUserLimitRow } from '@markettrader/shared';
import {
  useAdminClearUserLimit,
  useAdminSetUserLimit,
  useAdminUserLimits,
} from '@/api/admin/limits';
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
import { ApiError } from '@/lib/api';
import { LIMIT_LABELS, limitLabel } from '@/lib/limitLabels';
import { toastApiError } from '@/lib/toastApiError';
import { LimitBasisBadge, LimitUsageBar } from './LimitUsage';
import { LimitOverrideEditor } from './LimitOverrideEditor';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Effective limits, usage, overrides, and abuse signals for one user (admin user detail page). */
export function UserLimitsCard({ userId }: { userId: string }) {
  const limits = useAdminUserLimits(userId);
  const setLimit = useAdminSetUserLimit();
  const clearLimit = useAdminClearUserLimit();
  const [clearing, setClearing] = useState<AdminUserLimitRow | null>(null);
  const pending = setLimit.isPending || clearLimit.isPending;

  async function save(
    row: AdminUserLimitRow,
    value: number,
    note: string | null,
  ): Promise<boolean> {
    try {
      await setLimit.mutateAsync({ userId, key: row.key, value, ...(note !== null && { note }) });
      toast({ title: `${LIMIT_LABELS[row.key]} override saved`, variant: 'success' });
      return true;
    } catch (err) {
      toastApiError(
        err,
        err instanceof ApiError && err.status === 400 ? 'Invalid override' : 'Override failed',
      );
      return false;
    }
  }

  async function confirmClear() {
    if (!clearing) return;
    try {
      await clearLimit.mutateAsync({ userId, key: clearing.key });
      toast({ title: `${LIMIT_LABELS[clearing.key]} override cleared`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Clear failed');
    } finally {
      setClearing(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Limits &amp; usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {limits.isLoading && <Skeleton className="h-48 w-full" />}
        {limits.isError && <p className="text-sm text-destructive">Could not load limits.</p>}
        {limits.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {limits.data.mature || !limits.data.probationEndsAt
                ? 'Mature account'
                : `On probation until ${formatDate(limits.data.probationEndsAt)}`}{' '}
              · non-override limits are ×{limits.data.privilegedMultiplier} on privileged IPs
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Limit</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Override</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limits.data.rows.map((row) => (
                    <TableRow key={row.key} data-limit-key={row.key}>
                      <TableCell className="align-top">
                        <div className="text-sm font-medium">{LIMIT_LABELS[row.key]}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {row.configKey}
                        </div>
                      </TableCell>
                      <TableCell className="align-top font-mono text-xs">
                        <div>{row.effectiveMax ?? 'Unlimited'}</div>
                        {row.basis !== 'base' && (
                          <div className="text-muted-foreground">base {row.baseValue}</div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <LimitBasisBadge basis={row.basis} />
                        {row.override?.note && (
                          <p className="mt-1 max-w-[12rem] text-xs text-muted-foreground">
                            {row.override.note}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <LimitUsageBar used={row.used} max={row.effectiveMax} />
                      </TableCell>
                      <TableCell className="align-top">
                        <LimitOverrideEditor
                          key={`${row.key}:${row.override?.value ?? 'none'}`}
                          row={row}
                          pending={pending}
                          onSave={(value, note) => save(row, value, note)}
                          onClear={() => setClearing(row)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Registration IP</h3>
              <p className="font-mono text-xs">
                {limits.data.registrationIp ?? 'Not recorded (registered before limits shipped)'}
              </p>
              {limits.data.siblingAccounts.length > 0 ? (
                <ul className="text-sm">
                  {limits.data.siblingAccounts.map((s) => (
                    <li key={s.id}>
                      <Link to={`/admin/users/${s.id}`} className="hover:underline">
                        {s.username}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">
                        registered {formatDate(s.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                limits.data.registrationIp && (
                  <p className="text-xs text-muted-foreground">
                    No other account registered from this IP.
                  </p>
                )
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Requests by route (7 days)</h3>
              {limits.data.requestVolume7d.length === 0 ? (
                <p className="text-xs text-muted-foreground">No requests recorded.</p>
              ) : (
                <Table>
                  <TableBody>
                    {limits.data.requestVolume7d.map((v) => (
                      <TableRow key={v.route}>
                        <TableCell className="font-mono text-xs">{v.route}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{v.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Denials (7 days)</h3>
              {limits.data.denials7d.length === 0 ? (
                <p className="text-xs text-muted-foreground">No limit was hit.</p>
              ) : (
                <Table>
                  <TableBody>
                    {limits.data.denials7d.map((d) => (
                      <TableRow key={d.limitKey}>
                        <TableCell className="text-xs">{limitLabel(d.limitKey)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.count}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          last {formatDate(d.lastAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => !open && setClearing(null)}
        title={`Clear the ${clearing ? LIMIT_LABELS[clearing.key] : ''} override?`}
        description="The global value (with probation and privileged-IP adjustments) applies again from the next request."
        confirmLabel="Clear override"
        onConfirm={confirmClear}
      />
    </Card>
  );
}

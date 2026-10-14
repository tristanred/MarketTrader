import { useMemo, useState } from 'react';
import type { AdminConfigEntry, ConfigCategory } from '@markettrader/shared';
import { useAdminConfig } from '@/api/admin/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfigEntryRow } from '@/components/admin/ConfigEntryRow';
import { clientBuildConfig } from '@/lib/clientBuildConfig';

const CATEGORY_LABELS: Record<ConfigCategory, string> = {
  core: 'Core',
  security: 'Security & auth',
  database: 'Database',
  'stock-data': 'Stock data',
  'market-hours': 'Market hours',
  workers: 'Background workers',
  limits: 'Limits',
  websocket: 'WebSockets',
  observability: 'OpenTelemetry',
  analytics: 'PostHog',
};

function matches(entry: AdminConfigEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || entry.key.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
}

/** Admin view of every host option, with inline editing for the live-editable ones. */
export function AdminConfigPage() {
  const config = useAdminConfig();
  const [query, setQuery] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);

  const groups = useMemo(() => {
    const visible = (config.data?.entries ?? []).filter(
      (e) => matches(e, query) && (!liveOnly || e.mutability === 'live'),
    );
    return (Object.keys(CATEGORY_LABELS) as ConfigCategory[])
      .map((category) => ({ category, entries: visible.filter((e) => e.category === category) }))
      .filter((g) => g.entries.length > 0);
  }, [config.data, query, liveOnly]);

  const overrideCount = config.data?.entries.filter((e) => e.override).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          The options this server booted with. Live options can be changed here: the change applies
          immediately, persists across restarts, and wins over the environment until you reset it.
        </p>
      </div>

      {overrideCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {overrideCount} runtime override{overrideCount === 1 ? '' : 's'} active — the environment value
          is ignored for {overrideCount === 1 ? 'it' : 'them'} until reset.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder="Filter options…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
          Live-editable only
        </label>
      </div>

      {config.isLoading && <Skeleton className="h-64 w-full" />}
      {config.isError && <p className="text-sm text-destructive">Could not load configuration.</p>}

      {groups.map(({ category, entries }) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-base">{CATEGORY_LABELS[category]}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Option</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <ConfigEntryRow key={e.key} entry={e} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frontend build</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <p className="mb-2 text-xs text-muted-foreground">
            Inlined by Vite when this bundle was built. Changing one requires rebuilding the frontend.
          </p>
          <Table>
            <TableBody>
              {clientBuildConfig().map((b) => (
                <TableRow key={b.key}>
                  <TableCell className="align-top">
                    <div className="font-mono text-xs font-medium">{b.key}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{b.description}</p>
                  </TableCell>
                  <TableCell className="align-top font-mono text-xs">{b.value || '(empty)'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

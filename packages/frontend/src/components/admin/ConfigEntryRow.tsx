import { ApiError } from '@/lib/api';
import type { AdminConfigEntry, ConfigValue, ConfigValueSource } from '@markettrader/shared';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/lib/toastApiError';
import { formatConfigValue } from '@/lib/configFormat';
import { cn } from '@/lib/utils';
import { useAdminResetConfig, useAdminSetConfig } from '@/api/admin/config';
import { ConfigValueEditor } from './ConfigValueEditor';

const SOURCE_STYLE: Record<ConfigValueSource, { label: string; className: string }> = {
  default: { label: 'Default', className: 'border border-hairline-strong text-text' },
  env: { label: 'Environment', className: 'bg-accent-bg text-accent' },
  override: { label: 'Override', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

/** One option in the configuration table: value, provenance, and an editor when live. */
export function ConfigEntryRow({ entry }: { entry: AdminConfigEntry }) {
  const setConfig = useAdminSetConfig();
  const resetConfig = useAdminResetConfig();
  const source = SOURCE_STYLE[entry.source];

  async function save(value: ConfigValue) {
    try {
      await setConfig.mutateAsync({ key: entry.key, value });
      toast({ title: `${entry.key} updated`, variant: 'success' });
    } catch (err) {
      // Any 400 is a validation rejection (service check or Fastify schema); its message says why.
      toastApiError(err, err instanceof ApiError && err.status === 400 ? 'Invalid value' : 'Update failed');
    }
  }

  async function reset() {
    try {
      await resetConfig.mutateAsync(entry.key);
      toast({ title: `${entry.key} reset to environment`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Reset failed');
    }
  }

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-mono text-xs font-medium">{entry.key}</div>
        {entry.envVars.length > 1 && (
          <div className="text-xs text-muted-foreground">also read: {entry.envVars.slice(1).join(', ')}</div>
        )}
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{entry.description}</p>
      </TableCell>
      <TableCell className="align-top font-mono text-xs">
        <div>{formatConfigValue(entry, entry.effectiveValue)}</div>
        {entry.override && (
          <div className="text-muted-foreground">
            environment: {formatConfigValue(entry, entry.bootValue)}
            {entry.override.updatedBy && ` · set by ${entry.override.updatedBy}`}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', source.className)}>{source.label}</span>
      </TableCell>
      <TableCell className="align-top">
        {entry.mutability === 'live' ? (
          <ConfigValueEditor
            key={String(entry.effectiveValue)}
            entry={entry}
            pending={setConfig.isPending || resetConfig.isPending}
            onSave={(v) => void save(v)}
            onReset={() => void reset()}
          />
        ) : (
          <span className="text-xs text-muted-foreground" title={entry.restartReason ?? undefined}>
            Restart required
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

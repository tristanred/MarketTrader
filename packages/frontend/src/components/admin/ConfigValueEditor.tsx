import { useState } from 'react';
import type { AdminConfigEntry, ConfigValue } from '@markettrader/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMs, parseConfigDraft } from '@/lib/configFormat';

interface ConfigValueEditorProps {
  entry: AdminConfigEntry;
  pending: boolean;
  onSave: (value: ConfigValue) => void;
  onReset: () => void;
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Inline editor for one live option. Client-side parsing only gates the Save
 * button; the server re-validates every write. Remount it (via `key`) when the
 * effective value changes so the draft resets.
 */
export function ConfigValueEditor({ entry, pending, onSave, onReset }: ConfigValueEditorProps) {
  const [draft, setDraft] = useState(() => String(entry.effectiveValue ?? ''));
  const parsed = parseConfigDraft(entry, draft);
  const changed = parsed.ok && parsed.value !== entry.effectiveValue;
  const label = `${entry.key} value`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {entry.kind === 'boolean' || entry.kind === 'enum' ? (
          <select aria-label={label} className={selectClass} value={draft} onChange={(e) => setDraft(e.target.value)}>
            {(entry.kind === 'boolean' ? ['true', 'false'] : (entry.options ?? [])).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : (
          <Input
            aria-label={label}
            className="h-9 w-36"
            inputMode={entry.kind === 'integer' ? 'numeric' : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        <Button size="sm" disabled={!changed || pending} onClick={() => parsed.ok && onSave(parsed.value)}>
          Save
        </Button>
        {entry.override && (
          <Button size="sm" variant="outline" disabled={pending} onClick={onReset}>
            Reset to environment
          </Button>
        )}
      </div>
      {!parsed.ok && <span className="text-xs text-destructive">{parsed.error}</span>}
      {parsed.ok && entry.unit === 'ms' && typeof parsed.value === 'number' && (
        <span className="text-xs text-muted-foreground">{formatMs(parsed.value)}</span>
      )}
      {entry.min !== null && entry.max !== null && (
        <span className="text-xs text-muted-foreground">
          Allowed here: {entry.min}–{entry.max} (stricter than the environment allows)
        </span>
      )}
    </div>
  );
}

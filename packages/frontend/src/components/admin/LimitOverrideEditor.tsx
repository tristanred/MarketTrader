import { useState, type FormEvent } from 'react';
import type { AdminUserLimitRow } from '@markettrader/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LIMIT_LABELS } from '@/lib/limitLabels';

interface LimitOverrideEditorProps {
  row: AdminUserLimitRow;
  pending: boolean;
  /** Resolves true when saved, so the form closes only on success. */
  onSave: (value: number, note: string | null) => Promise<boolean>;
  onClear: () => void;
}

/** Inline per-user override form for one limit row. */
export function LimitOverrideEditor({ row, pending, onSave, onClear }: LimitOverrideEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.override?.value ?? row.baseValue));
  const [note, setNote] = useState(row.override?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!row.overridable)
    return <span className="text-xs text-muted-foreground">Not overridable</span>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError('Whole number ≥ 1');
      return;
    }
    setError(null);
    const trimmed = note.trim();
    if (await onSave(parsed, trimmed === '' ? null : trimmed)) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-label={`Override ${LIMIT_LABELS[row.key]}`}
          onClick={() => setEditing(true)}
        >
          {row.override ? 'Edit' : 'Override'}
        </Button>
        {row.override && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Clear override for ${LIMIT_LABELS[row.key]}`}
            disabled={pending}
            onClick={onClear}
          >
            Clear
          </Button>
        )}
      </div>
    );
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <Input
        type="number"
        min={1}
        step={1}
        className="w-28"
        aria-label={`Override value for ${LIMIT_LABELS[row.key]}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Input
        className="w-56"
        maxLength={500}
        placeholder="Why? (optional)"
        aria-label={`Override note for ${LIMIT_LABELS[row.key]}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

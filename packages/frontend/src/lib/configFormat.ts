import type { AdminConfigEntry, ConfigValue } from '@markettrader/shared';

const UNITS: [suffix: string, ms: number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
];

/** `90000` → `1m 30s`. Sub-second values stay in ms. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const parts: string[] = [];
  let rest = ms;
  for (const [suffix, size] of UNITS) {
    const n = Math.floor(rest / size);
    if (n > 0) parts.push(`${n}${suffix}`);
    rest -= n * size;
  }
  return parts.join(' ');
}

/** Display text for a config value. Secrets render as set/not set, never as a value. */
export function formatConfigValue(entry: AdminConfigEntry, value: ConfigValue | null): string {
  if (entry.secret) return entry.isSet ? 'Set (hidden)' : 'Not set';
  if (value === null) return '—';
  if (value === '') return '(empty)';
  if (entry.unit === 'ms' && typeof value === 'number') return `${value} ms (${formatMs(value)})`;
  return String(value);
}

/** Outcome of parsing editor text: the typed value, or a message for the editor. */
export type DraftResult = { ok: true; value: ConfigValue } | { ok: false; error: string };

/** Parses editor text into the option's JSON type. Advisory — the server re-validates. */
export function parseConfigDraft(entry: AdminConfigEntry, draft: string): DraftResult {
  switch (entry.kind) {
    case 'integer': {
      if (!/^\d+$/.test(draft.trim())) return { ok: false, error: 'Whole number required' };
      const n = Number(draft);
      if (entry.min !== null && n < entry.min) return { ok: false, error: `Minimum ${entry.min}` };
      if (entry.max !== null && n > entry.max) return { ok: false, error: `Maximum ${entry.max}` };
      return { ok: true, value: n };
    }
    case 'boolean':
      return { ok: true, value: draft === 'true' };
    case 'enum':
      return entry.options?.includes(draft) ? { ok: true, value: draft } : { ok: false, error: 'Pick an option' };
    case 'string':
      return { ok: true, value: draft };
  }
}

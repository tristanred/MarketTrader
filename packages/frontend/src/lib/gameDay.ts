const MS_PER_DAY = 86_400_000;

export interface DayCounter {
  /** 1-indexed day number within the game window, clamped to [1, dayTotal]. */
  dayCurrent: number;
  /** Inclusive total number of days the game spans. */
  dayTotal: number;
}

/**
 * Converts a game window plus a reference time into a 1-indexed day counter
 * for display in the status strip. Day boundaries align to UTC midnight so
 * the counter doesn't drift across timezones.
 *
 * Before the game starts, returns day 1. After it ends, returns dayTotal.
 */
export function getDayCounter(
  startIso: string,
  endIso: string,
  now: Date,
): DayCounter {
  const startMs = Date.UTC(...utcParts(startIso));
  const endMs = Date.UTC(...utcParts(endIso));
  const nowMs = Date.UTC(...utcParts(now.toISOString()));

  const dayTotal = Math.max(1, Math.floor((endMs - startMs) / MS_PER_DAY) + 1);
  const rawCurrent = Math.floor((nowMs - startMs) / MS_PER_DAY) + 1;
  const dayCurrent = Math.min(Math.max(rawCurrent, 1), dayTotal);
  return { dayCurrent, dayTotal };
}

function utcParts(iso: string): [number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

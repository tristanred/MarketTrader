/** Inclusive random integer in `[min, max]`. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Returns a uniformly random element from `arr`. Throws if `arr` is empty. */
export function pick<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick(): array is empty');
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx]!;
}

/** Coin flip biased toward `true` with probability `pTrue`. */
export function coinFlip(pTrue: number): boolean {
  return Math.random() < pTrue;
}

/**
 * Returns `count` ISO 8601 timestamps drawn uniformly from `[startISO, endISO]`,
 * sorted ascending. Used to scatter synthetic trades across a game's lifetime.
 */
export function randomTimestampsBetween(
  startISO: string,
  endISO: string,
  count: number,
): string[] {
  const startMs = new Date(startISO).getTime();
  const endMs = new Date(endISO).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error(`Invalid date range: ${startISO} → ${endISO}`);
  }
  if (endMs <= startMs) {
    throw new Error(`End must be after start: ${startISO} → ${endISO}`);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(startMs + Math.random() * (endMs - startMs));
  }
  out.sort((a, b) => a - b);
  return out.map((ms) => new Date(ms).toISOString());
}

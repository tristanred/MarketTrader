import { SP500, type UniverseEntry } from './sp500.js';

/** How many daily picks each game gets per session date. */
export const DAILY_PICKS_COUNT = 20;

/**
 * Samples {@link DAILY_PICKS_COUNT} distinct S&P 500 constituents for a game's
 * session date. Seeded by `gameId:sessionDate`, so the same inputs always give
 * the same picks and each game sees its own set.
 */
export function sampleDailyPicks(gameId: string, sessionDate: string): UniverseEntry[] {
  const rand = mulberry32(fnv1a(`${gameId}:${sessionDate}`));
  const pool = [...SP500];
  const count = Math.min(DAILY_PICKS_COUNT, pool.length);
  // Partial Fisher–Yates: only the first `count` slots need shuffling.
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(rand() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

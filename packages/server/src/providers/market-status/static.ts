import { isHoliday } from 'nyse-holidays';
import type { MarketState, MarketStatusResult } from '@markettrader/shared';
import type { MarketStatusProvider } from './interface.js';

interface NyParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

/**
 * Returns the NYSE session for `now` using a static schedule:
 *   04:00–09:30 ET → PRE, 09:30–16:00 → REGULAR, 16:00–20:00 → POST, else CLOSED.
 * Weekends and NYSE holidays (via the `nyse-holidays` package) are always CLOSED.
 *
 * Half-day early closes (e.g. day after Thanksgiving) are NOT modeled — operators
 * who need that accuracy should switch to a live source (Alpaca/Yahoo).
 */
export class StaticMarketStatus implements MarketStatusProvider {
  async getStatus(): Promise<MarketStatusResult> {
    const now = new Date();
    const parts = nyParts(now);
    const state = computeState(parts);
    return {
      state,
      asOf: now.toISOString(),
      source: 'static',
    };
  }
}

function nyParts(d: Date): NyParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });
  const map = new Map<string, string>();
  for (const p of fmt.formatToParts(d)) map.set(p.type, p.value);
  // Intl returns '24' for midnight in some locales; normalize to 0.
  const rawHour = parseInt(map.get('hour') ?? '0', 10);
  return {
    year: parseInt(map.get('year') ?? '1970', 10),
    month: parseInt(map.get('month') ?? '1', 10),
    day: parseInt(map.get('day') ?? '1', 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(map.get('minute') ?? '0', 10),
    weekday: map.get('weekday') ?? '',
  };
}

function computeState(p: NyParts): MarketState {
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'CLOSED';
  // Construct a date with the NY calendar components (treated as local tz) —
  // nyse-holidays compares via toDateString() which is local-zone, so a Date
  // built from the same calendar parts collides correctly with the package's
  // holiday entries.
  if (isHoliday(new Date(p.year, p.month - 1, p.day))) return 'CLOSED';
  const minutes = p.hour * 60 + p.minute;
  if (minutes < 4 * 60) return 'CLOSED';
  if (minutes < 9 * 60 + 30) return 'PRE';
  if (minutes < 16 * 60) return 'REGULAR';
  if (minutes < 20 * 60) return 'POST';
  return 'CLOSED';
}

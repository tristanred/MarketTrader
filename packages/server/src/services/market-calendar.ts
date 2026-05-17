import { isHoliday } from 'nyse-holidays';

/**
 * NYSE regular session window in UTC. `start` is 09:30 ET, `end` is 16:00 ET
 * (or `now` if the session is still in progress). Both are `Date` instances
 * suitable for passing to upstream history providers.
 */
export interface TradingSession {
  start: Date;
  end: Date;
  /** ISO date (YYYY-MM-DD) of the session in America/New_York. */
  isoDate: string;
}

/**
 * Returns the most recent NYSE regular session window relative to `now`.
 *
 * Rules:
 *   - If `now` is during today's regular session (09:30–16:00 ET on a
 *     trading day), the window is [today 09:30 ET, now].
 *   - Otherwise, the window is the full session of the most recent
 *     completed trading day: [date 09:30 ET, date 16:00 ET]. Weekends
 *     and NYSE holidays are skipped backward.
 *
 * The function is deterministic in `now` — passing the same Date returns
 * the same window. This makes the 1D price chart show data even on
 * weekends, holidays, and overnight/pre-market hours by always falling
 * back to the previous full session.
 *
 * Half-day early closes (e.g. day-after-Thanksgiving) are not modeled —
 * the function still returns 16:00 ET as the end of those sessions. The
 * provider only uses the window to bound a request; extra "empty"
 * minutes don't pollute the result.
 */
export function mostRecentTradingSession(now: Date = new Date()): TradingSession {
  const nowParts = nyParts(now);
  const minutes = nowParts.hour * 60 + nowParts.minute;
  const isTradingToday = isTradingDay(nowParts);

  // Live in-progress session.
  if (isTradingToday && minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return {
      start: nyDateAt(nowParts, 9, 30),
      end: now,
      isoDate: isoDate(nowParts),
    };
  }

  // Walk backward day by day until we hit a trading weekday. Includes today
  // if the regular session has already completed (now ≥ 16:00 ET).
  const startParts = isTradingToday && minutes >= 16 * 60 ? nowParts : previousDayParts(nowParts);
  let cursor = startParts;
  // 14 days is more than enough to cover the longest holiday gap (Christmas
  // through New Year typically spans ~5 calendar days).
  for (let i = 0; i < 14; i += 1) {
    if (isTradingDay(cursor)) {
      return {
        start: nyDateAt(cursor, 9, 30),
        end: nyDateAt(cursor, 16, 0),
        isoDate: isoDate(cursor),
      };
    }
    cursor = previousDayParts(cursor);
  }

  // Unreachable in practice (no NYSE calendar has 14 consecutive non-trading
  // days), but return a sensible last-resort to keep the type safe.
  return {
    start: nyDateAt(startParts, 9, 30),
    end: nyDateAt(startParts, 16, 0),
    isoDate: isoDate(startParts),
  };
}

interface NyParts {
  year: number;
  /** 1-indexed month, matching humans (and the `Date` constructor wants 0-indexed). */
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
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

function isTradingDay(p: NyParts): boolean {
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  // nyse-holidays compares via toDateString() in the local zone — build
  // a Date from the same calendar components so the comparison collides
  // regardless of where the server runs.
  return !isHoliday(new Date(p.year, p.month - 1, p.day));
}

function previousDayParts(p: NyParts): NyParts {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) - 86_400_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: 0,
    minute: 0,
    weekday: SHORT_WEEKDAYS[d.getUTCDay()] ?? '',
  };
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Builds a UTC `Date` representing `hour:minute` ET on the calendar day
 * described by `p`. Uses the IANA tz database to find the correct UTC
 * offset for that date (handles DST cleanly).
 */
function nyDateAt(p: NyParts, hour: number, minute: number): Date {
  // Start with a naive UTC instant for the wall-clock time, then correct
  // by ET's offset on that date.
  const naiveUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
  const offsetMs = etOffsetMs(new Date(naiveUtc));
  return new Date(naiveUtc - offsetMs);
}

/**
 * Returns the offset of America/New_York from UTC, in milliseconds, on
 * the given instant. Negative for EST (-5h), -4h for EDT.
 */
function etOffsetMs(instant: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const map = new Map<string, string>();
  for (const p of fmt.formatToParts(instant)) map.set(p.type, p.value);
  const y = parseInt(map.get('year') ?? '1970', 10);
  const mo = parseInt(map.get('month') ?? '1', 10);
  const d = parseInt(map.get('day') ?? '1', 10);
  let h = parseInt(map.get('hour') ?? '0', 10);
  if (h === 24) h = 0;
  const mi = parseInt(map.get('minute') ?? '0', 10);
  const s = parseInt(map.get('second') ?? '0', 10);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return asUtc - instant.getTime();
}

function isoDate(p: NyParts): string {
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

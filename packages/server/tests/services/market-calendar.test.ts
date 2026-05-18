import { describe, it, expect } from 'vitest';
import { mostRecentTradingSession } from '../../src/services/market-calendar.js';

/**
 * The session window is computed in America/New_York. The tests below use
 * concrete UTC instants and check the returned `isoDate` so DST-related
 * arithmetic is exercised on both sides of the calendar.
 */
describe('mostRecentTradingSession', () => {
  it('returns Friday session when called on a Saturday', () => {
    // Saturday 2026-05-16 12:00 UTC = Sat 08:00 ET.
    const sat = new Date(Date.UTC(2026, 4, 16, 12, 0, 0));
    const s = mostRecentTradingSession(sat);
    expect(s.isoDate).toBe('2026-05-15');
    // Window covers the full regular session.
    expect(s.end.getTime() - s.start.getTime()).toBe((6 * 60 + 30) * 60_000);
  });

  it('returns Friday session when called on a Sunday', () => {
    const sun = new Date(Date.UTC(2026, 4, 17, 18, 0, 0));
    expect(mostRecentTradingSession(sun).isoDate).toBe('2026-05-15');
  });

  it('returns yesterday session when called pre-market on a weekday', () => {
    // Tuesday 2026-05-19 08:00 ET (12:00 UTC during EDT) → before today's
    // 09:30 open, so the most recent COMPLETED session is Monday.
    const tueEarly = new Date(Date.UTC(2026, 4, 19, 12, 0, 0));
    expect(mostRecentTradingSession(tueEarly).isoDate).toBe('2026-05-18');
  });

  it('returns the live in-progress session during regular hours', () => {
    // Tuesday 2026-05-19 14:00 ET (18:00 UTC during EDT) → mid-session.
    const tueMid = new Date(Date.UTC(2026, 4, 19, 18, 0, 0));
    const s = mostRecentTradingSession(tueMid);
    expect(s.isoDate).toBe('2026-05-19');
    // End should be `now`, not 16:00 ET.
    expect(s.end.getTime()).toBe(tueMid.getTime());
  });

  it('returns today after-hours session once the close is past', () => {
    // Tuesday 2026-05-19 17:00 ET (21:00 UTC during EDT) → after 16:00 close.
    const tueAfter = new Date(Date.UTC(2026, 4, 19, 21, 0, 0));
    const s = mostRecentTradingSession(tueAfter);
    expect(s.isoDate).toBe('2026-05-19');
    // End should be today's 16:00 ET.
    expect(s.end.getTime() - s.start.getTime()).toBe((6 * 60 + 30) * 60_000);
  });

  it('skips an NYSE holiday — Independence Day 2026 falls on a Saturday so observed on Friday Jul 3', () => {
    // Monday 2026-07-06 morning, pre-market. The previous completed session
    // is NOT Friday Jul 3 (observed holiday) but Thursday Jul 2.
    const monAfterHoliday = new Date(Date.UTC(2026, 6, 6, 12, 0, 0));
    expect(mostRecentTradingSession(monAfterHoliday).isoDate).toBe('2026-07-02');
  });
});

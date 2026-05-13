import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaticMarketStatus } from '../../../src/providers/market-status/static.js';

/**
 * Build a UTC Date that corresponds to the given NY-local wall clock for an
 * EDT day (UTC-4). Used so the wall-clock-driven static provider gives
 * predictable results regardless of the host's timezone.
 */
function nyEdt(year: number, monthIdx: number, day: number, h: number, m: number): Date {
  return new Date(Date.UTC(year, monthIdx, day, h + 4, m));
}

describe('StaticMarketStatus', () => {
  let provider: StaticMarketStatus;

  beforeEach(() => {
    provider = new StaticMarketStatus();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns REGULAR on a Tuesday at 10:00 ET', async () => {
    // 2026-05-12 is a Tuesday, EDT.
    vi.setSystemTime(nyEdt(2026, 4, 12, 10, 0));
    const s = await provider.getStatus();
    expect(s.state).toBe('REGULAR');
    expect(s.source).toBe('static');
  });

  it('returns PRE before 09:30 ET on a weekday', async () => {
    vi.setSystemTime(nyEdt(2026, 4, 12, 5, 0));
    expect((await provider.getStatus()).state).toBe('PRE');
  });

  it('returns POST between 16:00 and 20:00 ET on a weekday', async () => {
    vi.setSystemTime(nyEdt(2026, 4, 12, 18, 0));
    expect((await provider.getStatus()).state).toBe('POST');
  });

  it('returns CLOSED late at night on a weekday', async () => {
    vi.setSystemTime(nyEdt(2026, 4, 12, 22, 0));
    expect((await provider.getStatus()).state).toBe('CLOSED');
  });

  it('returns CLOSED on a Saturday', async () => {
    // 2026-05-09 is a Saturday.
    vi.setSystemTime(nyEdt(2026, 4, 9, 10, 0));
    expect((await provider.getStatus()).state).toBe('CLOSED');
  });

  it('returns CLOSED on Christmas Day (NYSE holiday)', async () => {
    // 2026-12-25 is a Friday — would otherwise be REGULAR at 10:00.
    // EST in December = UTC-5, so add 5 hours not 4.
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 25, 15, 0)));
    expect((await provider.getStatus()).state).toBe('CLOSED');
  });

  it('asOf reflects the system time', async () => {
    const t = nyEdt(2026, 4, 12, 10, 0);
    vi.setSystemTime(t);
    const s = await provider.getStatus();
    expect(s.asOf).toBe(t.toISOString());
  });
});

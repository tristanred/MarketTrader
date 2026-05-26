import { describe, it, expect } from 'vitest';
import { utcDayKey } from '../../src/services/game-player-stats.js';

describe('utcDayKey', () => {
  it('formats an ISO timestamp as YYYY-MM-DD in UTC', () => {
    expect(utcDayKey('2026-05-25T23:59:00.000Z')).toBe('2026-05-25');
    expect(utcDayKey('2026-05-26T00:00:00.000Z')).toBe('2026-05-26');
  });

  it('uses UTC, not local time', () => {
    expect(utcDayKey('2026-05-25T23:30:00.000Z')).toBe('2026-05-25');
  });
});

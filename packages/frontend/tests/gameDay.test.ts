import { describe, expect, it } from 'vitest';
import { getDayCounter } from '@/lib/gameDay';

describe('getDayCounter', () => {
  it('returns day 1 / N at the moment a game starts', () => {
    const result = getDayCounter(
      '2026-05-12T13:30:00Z',
      '2026-05-25T20:00:00Z',
      new Date('2026-05-12T13:30:00Z'),
    );
    expect(result.dayCurrent).toBe(1);
    expect(result.dayTotal).toBe(14);
  });

  it('returns day 4 / 14 four days into a fourteen-day game', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T23:59:59Z',
      new Date('2026-05-15T18:00:00Z'),
    );
    expect(result.dayCurrent).toBe(4);
    expect(result.dayTotal).toBe(14);
  });

  it('caps dayCurrent at dayTotal once the game has ended', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T23:59:59Z',
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(result.dayCurrent).toBe(14);
    expect(result.dayTotal).toBe(14);
  });

  it('returns day 1 / N if `now` is before the game starts', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T00:00:00Z',
      new Date('2026-05-10T00:00:00Z'),
    );
    expect(result.dayCurrent).toBe(1);
    expect(result.dayTotal).toBe(14);
  });

  it('uses UTC day boundaries so timezone-quirky users still see the same counter', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T00:00:00Z',
      new Date('2026-05-15T07:00:00Z'),
    );
    expect(result.dayCurrent).toBe(4);
  });

  it('handles a one-day game', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-12T23:59:59Z',
      new Date('2026-05-12T12:00:00Z'),
    );
    expect(result.dayCurrent).toBe(1);
    expect(result.dayTotal).toBe(1);
  });
});

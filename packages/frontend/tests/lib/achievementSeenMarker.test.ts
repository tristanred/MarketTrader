import { beforeEach, describe, expect, it } from 'vitest';
import { getSeenMarker, advanceSeenMarker, isAlreadySeen } from '@/lib/achievementSeenMarker';

describe('achievementSeenMarker', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no marker has been stored', () => {
    expect(getSeenMarker('g1', 'p1')).toBeNull();
  });

  it('advances and reads back the marker', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    expect(getSeenMarker('g1', 'p1')).toBe('2026-05-23T12:00:00.000Z');
  });

  it('never regresses to an older timestamp', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    advanceSeenMarker('g1', 'p1', '2026-05-23T11:00:00.000Z');
    expect(getSeenMarker('g1', 'p1')).toBe('2026-05-23T12:00:00.000Z');
  });

  it('keeps separate markers per (gameId, gamePlayerId)', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    advanceSeenMarker('g2', 'p1', '2026-05-23T10:00:00.000Z');
    expect(getSeenMarker('g1', 'p1')).toBe('2026-05-23T12:00:00.000Z');
    expect(getSeenMarker('g2', 'p1')).toBe('2026-05-23T10:00:00.000Z');
  });

  it('isAlreadySeen returns true when the incoming unlock is <= marker', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T11:00:00.000Z')).toBe(true);
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T13:00:00.000Z')).toBe(false);
  });

  it('isAlreadySeen returns false when no marker exists', () => {
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T12:00:00.000Z')).toBe(false);
  });
});

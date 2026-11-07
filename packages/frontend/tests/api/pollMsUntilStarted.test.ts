import { describe, it, expect } from 'vitest';
import { pollMsUntilStarted } from '@/api/games';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');

describe('pollMsUntilStarted', () => {
  it.each([
    ['two hours out', 'pending', '2026-11-06T14:00:00.000Z', 60_000],
    ['just over a minute out', 'pending', '2026-11-06T12:01:00.001Z', 60_000],
    ['exactly a minute out', 'pending', '2026-11-06T12:01:00.000Z', 5_000],
    ['seconds out', 'pending', '2026-11-06T12:00:03.000Z', 5_000],
    // A browser clock ahead of the server: keep asking until the server agrees.
    ['past the start but still pending', 'pending', '2026-11-06T11:00:00.000Z', 5_000],
    ['active', 'active', '2026-11-06T11:00:00.000Z', false],
    ['ended', 'ended', '2026-11-06T11:00:00.000Z', false],
  ] as const)('%s', (_name, status, startDate, expected) => {
    expect(pollMsUntilStarted({ status, startDate }, NOW)).toBe(expected);
  });

  it('does not poll before the game has loaded', () => {
    expect(pollMsUntilStarted(undefined, NOW)).toBe(false);
  });
});

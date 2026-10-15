import { describe, it, expect } from 'vitest';
import { checkGameBounds } from '../../src/services/game-bounds.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const strict = RuntimeConfig.fromEnvironment({
  GAME_MAX_STARTING_BALANCE: 10_000_000,
  GAME_MAX_DURATION_DAYS: 365,
  GAME_MAX_START_DELAY_DAYS: 90,
});

function input(startOffsetDays: number, durationDays: number, startingBalance = 100_000) {
  const start = NOW + startOffsetDays * DAY;
  return {
    startDate: new Date(start).toISOString(),
    endDate: new Date(start + durationDays * DAY).toISOString(),
    startingBalance,
  };
}

describe('checkGameBounds', () => {
  it('accepts a game inside every bound', () => {
    expect(checkGameBounds(input(1, 30), strict, NOW)).toBeNull();
  });

  it('accepts exactly the maximum starting balance', () => {
    expect(checkGameBounds(input(1, 30, 10_000_000), strict, NOW)).toBeNull();
  });

  it('rejects a starting balance above the maximum', () => {
    expect(checkGameBounds(input(1, 30, 10_000_001), strict, NOW)).toMatch(/startingBalance/);
  });

  it('accepts exactly the maximum duration', () => {
    expect(checkGameBounds(input(1, 365), strict, NOW)).toBeNull();
  });

  it('rejects a duration one day over the maximum', () => {
    expect(checkGameBounds(input(1, 366), strict, NOW)).toMatch(/365 days/);
  });

  it('accepts a start exactly at the maximum delay', () => {
    expect(checkGameBounds(input(90, 10), strict, NOW)).toBeNull();
  });

  it('rejects a start beyond the maximum delay', () => {
    expect(checkGameBounds(input(91, 10), strict, NOW)).toMatch(/90 days/);
  });

  it('accepts a start date in the past', () => {
    expect(checkGameBounds(input(-10, 30), strict, NOW)).toBeNull();
  });

  it('reads the config on every call so an override applies immediately', () => {
    const config = RuntimeConfig.fromEnvironment({
      GAME_MAX_STARTING_BALANCE: 10_000_000,
      GAME_MAX_DURATION_DAYS: 365,
      GAME_MAX_START_DELAY_DAYS: 90,
    });
    expect(checkGameBounds(input(1, 30, 5_000), config, NOW)).toBeNull();
    config.set('GAME_MAX_STARTING_BALANCE', 1_000);
    expect(checkGameBounds(input(1, 30, 5_000), config, NOW)).toMatch(/startingBalance/);
  });
});

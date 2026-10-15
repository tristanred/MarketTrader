import type { ConfigReader } from '../config/runtime-config.js';

const DAY_MS = 86_400_000;

/** The `POST /games` fields that the live game bounds constrain. */
export interface GameBoundsInput {
  startDate: string;
  endDate: string;
  startingBalance: number;
}

/**
 * Checks a new game against `GAME_MAX_STARTING_BALANCE`, `GAME_MAX_DURATION_DAYS`
 * and `GAME_MAX_START_DELAY_DAYS`, read on every call so an admin override applies
 * to the next request. Returns the first violation's message, or `null`.
 */
export function checkGameBounds(
  input: GameBoundsInput,
  config: ConfigReader,
  now: number = Date.now(),
): string | null {
  const maxBalance = config.get('GAME_MAX_STARTING_BALANCE');
  if (input.startingBalance > maxBalance) {
    return `startingBalance must be at most ${maxBalance}`;
  }

  const start = Date.parse(input.startDate);
  const end = Date.parse(input.endDate);

  const maxDays = config.get('GAME_MAX_DURATION_DAYS');
  if (end - start > maxDays * DAY_MS) {
    return `A game may run for at most ${maxDays} days`;
  }

  const maxDelay = config.get('GAME_MAX_START_DELAY_DAYS');
  if (start - now > maxDelay * DAY_MS) {
    return `A game must start within ${maxDelay} days`;
  }

  return null;
}

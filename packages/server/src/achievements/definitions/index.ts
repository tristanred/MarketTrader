import type { AnyAchievementDefinition } from '../define.js';
import firstTrade from './first-trade.js';
import tenBuys from './ten-buys.js';
import rockBottom from './rock-bottom.js';

/**
 * The full registry of code-defined achievements. Adding a new achievement is:
 *   1. Create a new file in this directory using {@link defineAchievement}.
 *   2. Import it and append to this array.
 */
export const achievements: readonly AnyAchievementDefinition[] = [firstTrade, tenBuys, rockBottom];

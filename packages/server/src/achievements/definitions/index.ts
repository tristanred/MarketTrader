import type { AnyAchievementDefinition } from '../define.js';
import firstTrade from './first-trade.js';
import tenBuys from './ten-buys.js';
import rockBottom from './rock-bottom.js';
import apprentice from './apprentice.js';
import dayTrader from './day-trader.js';
import marketMaker from './market-maker.js';
import firstSale from './first-sale.js';
import sampler from './sampler.js';
import globeTrotter from './globe-trotter.js';
import firstBlood from './first-blood.js';
import greenStreak from './green-streak.js';
import moonshot from './moonshot.js';
import tenBagger from './ten-bagger.js';
import bagHolder from './bag-holder.js';
import catastrophe from './catastrophe.js';
import lockedIn from './locked-in.js';
import wolfOfMarketTrader from './wolf-of-markettrader.js';
import doubleUp from './double-up.js';
import tripleThreat from './triple-threat.js';
import underwater from './underwater.js';
import phoenix from './phoenix.js';

/**
 * The full registry of code-defined achievements. Adding a new achievement is:
 *   1. Create a new file in this directory using {@link defineAchievement}.
 *   2. Import it and append to this array.
 */
export const achievements: readonly AnyAchievementDefinition[] = [
  // Trading category
  firstTrade,
  tenBuys,
  apprentice,
  dayTrader,
  marketMaker,
  firstSale,
  sampler,
  globeTrotter,
  // P&L category
  firstBlood,
  greenStreak,
  moonshot,
  tenBagger,
  bagHolder,
  catastrophe,
  lockedIn,
  wolfOfMarketTrader,
  doubleUp,
  tripleThreat,
  underwater,
  phoenix,
  // Standing category
  rockBottom,
];

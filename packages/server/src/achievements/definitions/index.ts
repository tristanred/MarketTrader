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
import diversified from './diversified.js';
import indexFund from './index-fund.js';
import allIn from './all-in.js';
import cashIsKing from './cash-is-king.js';
import fullyInvested from './fully-invested.js';
import concentratedBet from './concentrated-bet.js';
import topOfTheClass from './top-of-the-class.js';
import reigningChamp from './reigning-champ.js';
import untouchable from './untouchable.js';
import podiumDays from './podium-days.js';
import aboveAverage from './above-average.js';
import comebackKid from './comeback-kid.js';
import freeFall from './free-fall.js';
import paperHands from './paper-hands.js';
import diamondHands from './diamond-hands.js';
import revengeTrade from './revenge-trade.js';
import fomo from './fomo.js';
import champion from './champion.js';
import podiumFinish from './podium-finish.js';
import honourableMention from './honourable-mention.js';
import woodenSpoon from './wooden-spoon.js';
import wireToWire from './wire-to-wire.js';
import achievementHorse from './achievement-horse.js';
import sixSeven from './six-seven.js';

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
  sixSeven,
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
  // Portfolio category
  diversified,
  indexFund,
  allIn,
  cashIsKing,
  fullyInvested,
  concentratedBet,
  // Standing category
  rockBottom,
  topOfTheClass,
  reigningChamp,
  untouchable,
  podiumDays,
  aboveAverage,
  comebackKid,
  freeFall,
  // Behavior category
  paperHands,
  diamondHands,
  revengeTrade,
  fomo,
  // Finale category
  champion,
  podiumFinish,
  honourableMention,
  woodenSpoon,
  wireToWire,
  // Meta category
  achievementHorse,
];

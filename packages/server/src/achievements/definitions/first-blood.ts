import { defineAchievement } from '../define.js';

/** Boolean unlock fired on a player's first profitable position close. */
export default defineAchievement({
  key: 'first-blood',
  name: 'First Blood',
  description: 'Close your first profitable position.',
  rarity: 'common',
  icon: 'droplet',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnl > 0) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});

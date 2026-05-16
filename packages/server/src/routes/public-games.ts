import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { recomputeMany } from '../services/game-status.js';
import { computeLeaderboard } from '../services/leaderboard.js';
import type { FeaturedGame } from '@markettrader/shared';

const MAX_GAMES = 5;
const TOP_N = 4;
const MS_PER_DAY = 86_400_000;

/**
 * Inclusive day counter mirroring the frontend's `getDayCounter`. The
 * frontend lives in /packages/frontend; we keep this small helper local
 * to the route so we don't have to import a frontend module from a
 * server module.
 */
function dayCounter(startIso: string, endIso: string, now: Date): { dayCurrent: number; dayTotal: number } {
  const utc = (iso: string): number => {
    const d = new Date(iso);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const startMs = utc(startIso);
  const endMs = utc(endIso);
  const nowMs = utc(now.toISOString());
  const dayTotal = Math.max(1, Math.floor((endMs - startMs) / MS_PER_DAY) + 1);
  const rawCurrent = Math.floor((nowMs - startMs) / MS_PER_DAY) + 1;
  const dayCurrent = Math.min(Math.max(rawCurrent, 1), dayTotal);
  return { dayCurrent, dayTotal };
}

/**
 * Unauthenticated read-only routes used by the login / register pages
 * to surface "top tournaments in progress." Intentionally exposes
 * usernames and totals — the same fields the in-arena leaderboard
 * already shows to every joined participant. No emails, no IDs of
 * private resources.
 */
export function publicGamesRoutes(db: Db) {
  return async function (app: FastifyInstance): Promise<void> {
    const { games } = schema;

    app.get('/public/featured-games', {
      schema: {
        tags: ['Public'],
        summary: 'Top active games + truncated leaderboards. No auth required.',
      },
    }, async (_request, reply) => {
      // Pull every game and recompute statuses; `recomputeMany` is the
      // same primitive `GET /games` uses, so "active" here means the
      // same thing as in the authenticated list.
      const rows = await db
        .select({
          id: games.id,
          name: games.name,
          startDate: games.startDate,
          endDate: games.endDate,
          startingBalance: games.startingBalance,
          status: games.status,
          createdAt: games.createdAt,
        })
        .from(games);

      const statusMap = await recomputeMany(db, rows);
      const active = rows
        .filter((g) => statusMap.get(g.id) === 'active')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const now = new Date();
      const featured: FeaturedGame[] = [];

      for (const g of active) {
        if (featured.length >= MAX_GAMES) break;
        const leaderboard = await computeLeaderboard(db, g.id);
        if (leaderboard.length === 0) continue;
        const start = Number(g.startingBalance);
        const trimmed = leaderboard.slice(0, TOP_N).map((e) => ({
          rank: e.rank,
          username: e.username,
          totalValue: e.totalValue,
          pnlPct: start > 0 ? ((e.totalValue - start) / start) * 100 : 0,
        }));
        const counter = dayCounter(g.startDate, g.endDate, now);
        featured.push({
          id: g.id,
          name: g.name,
          dayCurrent: counter.dayCurrent,
          dayTotal: counter.dayTotal,
          leaderboard: trimmed,
        });
      }

      // Stable secondary sort by total cap (sum of top totalValues) so
      // the "hottest" tournaments float to the top.
      featured.sort(
        (a, b) =>
          b.leaderboard.reduce((s, e) => s + e.totalValue, 0) -
          a.leaderboard.reduce((s, e) => s + e.totalValue, 0),
      );

      return reply.status(200).send(featured);
    });
  };
}

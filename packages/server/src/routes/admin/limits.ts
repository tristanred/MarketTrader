import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import {
  LIMIT_KEYS,
  type AdminLimitOverrideEntry,
  type AdminLimitPolicy,
  type AdminTopConsumersResponse,
  type AdminUserLimitRow,
  type AdminUserLimitsResponse,
  type LimitKey,
} from '@markettrader/shared';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { descriptorFor } from '../../config/registry.js';
import type { Limits } from '../../limits/index.js';
import { LIMIT_CATALOGUE, isLimitKey } from '../../limits/catalogue.js';
import { isMatureUser, isPrivilegedConnection, maturityEndsAt } from '../../limits/policy.js';
import { loadAccount, toIsoUtc, type RequestAccount } from '../../limits/account.js';
import {
  OPEN_ORDER_STATUSES,
  countActiveGamesJoined,
  countActiveGamesOwned,
  countGamesCreatedSince,
  countGamesJoinedSince,
  countRegistrationsSince,
  countStockAnalysesSince,
  windowStart,
} from '../../limits/quota-counts.js';
import {
  topConsumers,
  userDenials,
  userRequestVolume,
  windowStartIso,
} from '../../limits/usage-store.js';

const WEEK_HOURS = 24 * 7;
const SIBLING_LIMIT = 50;
const VOLUME_TOP_N = 10;

const userParams = z.object({ id: z.string().min(1).max(64) });
const userKeyParams = z.object({ id: z.string().min(1).max(64), key: z.string().min(1).max(64) });
const setBody = z.object({ value: z.number().int().min(1), note: z.string().max(500).optional() });
const topQuery = z.object({
  window: z.enum(['24h', '7d']).optional().default('24h'),
  metric: z.enum(['requests', 'denials']).optional().default('requests'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

/** The registry's `max` for the limit's config key — an override may exceed the default, not this. */
function overrideCeiling(key: LimitKey): number | undefined {
  const descriptor = descriptorFor(LIMIT_CATALOGUE[key].configKey);
  return descriptor.mutability === 'live' ? descriptor.max : undefined;
}

type KeyCheck =
  { ok: true; key: LimitKey } | { ok: false; status: 404 | 409; code: string; message: string };

function checkOverridableKey(raw: string): KeyCheck {
  if (!isLimitKey(raw)) {
    return { ok: false, status: 404, code: 'UNKNOWN_LIMIT_KEY', message: `No limit named ${raw}.` };
  }
  if (!LIMIT_CATALOGUE[raw].overridable) {
    return {
      ok: false,
      status: 409,
      code: 'LIMIT_NOT_OVERRIDABLE',
      message: `${raw} applies per IP address, not per user, so it has no per-user override.`,
    };
  }
  return { ok: true, key: raw };
}

interface TargetUser {
  account: RequestAccount;
  username: string;
  registrationIp: string | null;
}

/**
 * Admin limits endpoints (all `requireAdmin`): `/admin/limits/{policy,top,overrides}`
 * and `/admin/users/:id/limits[/:key]` (read, set, clear; writes audited).
 * `wsConnectionCount` reads the live socket registries, injected so this module
 * does not depend on the WS layer.
 */
export function adminLimitsRoutes(
  db: Db,
  limits: Limits,
  wsConnectionCount: (userId: string) => number,
) {
  const { config } = limits;
  const { users, gamePlayers, trades, watchlists, watchlistItems } = schema;

  async function loadTarget(id: string): Promise<TargetUser | undefined> {
    const account = await loadAccount(db, id);
    if (!account) return undefined;
    const [row] = await db
      .select({ username: users.username, registrationIp: users.registrationIp })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      account: { id: account.id, createdAt: account.createdAt, isAdmin: account.isAdmin },
      username: row.username,
      registrationIp: row.registrationIp,
    };
  }

  /** Accounts registered from `ip`, oldest first, including the target itself. */
  async function accountsFromIp(ip: string) {
    const rows = await db
      .select({ id: users.id, username: users.username, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.registrationIp, ip))
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(SIBLING_LIMIT + 1);
    return rows.map((r) => ({ id: r.id, username: r.username, createdAt: toIsoUtc(r.createdAt) }));
  }

  async function maxOpenOrdersInAnyGame(userId: string): Promise<number> {
    const rows = await db
      .select({ c: count() })
      .from(trades)
      .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
      .where(and(eq(gamePlayers.userId, userId), inArray(trades.status, [...OPEN_ORDER_STATUSES])))
      .groupBy(trades.gamePlayerId);
    return rows.reduce((m, r) => Math.max(m, Number(r.c)), 0);
  }

  async function maxItemsInAnyWatchlist(userId: string): Promise<number> {
    const rows = await db
      .select({ c: count() })
      .from(watchlistItems)
      .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
      .where(eq(watchlists.userId, userId))
      .groupBy(watchlistItems.watchlistId);
    return rows.reduce((m, r) => Math.max(m, Number(r.c)), 0);
  }

  /**
   * Current usage against `key`. Rate limits other than `apiRequests` live in
   * `@fastify/rate-limit`'s store, which exposes no read API, so they report null.
   * Per-scope limits (open orders per game, items per list) report the fullest scope.
   */
  async function usedFor(key: LimitKey, target: TargetUser, now: Date): Promise<number | null> {
    const userId = target.account.id;
    switch (key) {
      case 'apiRequests':
        // The sliding window weights the previous minute, so the estimate is fractional.
        return Math.ceil(limits.tracker.peekMinute(userId));
      case 'trades':
      case 'orderCancels':
      case 'codeLookups':
      case 'wsSubscribes':
        return null;
      case 'gamesCreated':
        // windowStart, not an ISO string: the stored SQLite timestamps compare textually.
        return countGamesCreatedSince(db, userId, windowStart('gamesCreated', now.getTime()));
      case 'activeGamesOwned':
        return countActiveGamesOwned(db, userId);
      case 'gamesJoined':
        return countGamesJoinedSince(db, userId, windowStart('gamesJoined', now.getTime()));
      case 'activeGamesJoined':
        return countActiveGamesJoined(db, userId);
      case 'openOrders':
        return maxOpenOrdersInAnyGame(userId);
      case 'watchlists': {
        const [row] = await db
          .select({ c: count() })
          .from(watchlists)
          .where(eq(watchlists.userId, userId));
        return Number(row?.c ?? 0);
      }
      case 'watchlistItems':
        return maxItemsInAnyWatchlist(userId);
      case 'wsConnections':
        return wsConnectionCount(userId);
      case 'registrationsPerIp': {
        if (!target.registrationIp) return null;
        return countRegistrationsSince(
          db,
          target.registrationIp,
          windowStart('registrationsPerIp', now.getTime()),
        );
      }
      case 'stockAnalyses':
        return countStockAnalysesSince(db, userId, windowStart('stockAnalyses', now.getTime()));
    }
  }

  async function buildRows(
    target: TargetUser,
    keys: readonly LimitKey[],
  ): Promise<AdminUserLimitRow[]> {
    const now = new Date();
    const overrides = await limits.overrides.listForUser(target.account.id);
    return Promise.all(
      keys.map(async (key): Promise<AdminUserLimitRow> => {
        const descriptor = LIMIT_CATALOGUE[key];
        const resolved = await limits.resolver.resolveForUser(target.account, key);
        const override = overrides.get(key);
        return {
          key,
          label: descriptor.label,
          kind: descriptor.kind,
          configKey: descriptor.configKey,
          baseValue: limits.resolver.baseValue(key),
          effectiveMax: resolved.max,
          basis: resolved.basis,
          override: override
            ? {
                value: override.value,
                note: override.note,
                updatedBy: override.updatedBy,
                updatedAt: override.updatedAt,
              }
            : null,
          used: await usedFor(key, target, now),
          overridable: descriptor.overridable,
        };
      }),
    );
  }

  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/admin/limits/policy',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'User-limit policy and the caller IP as seen by the server.',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        const body: AdminLimitPolicy = {
          enabled: !limits.resolver.isDisabled(),
          maturityDays: config.get('LIMITS_MATURITY_DAYS'),
          probationPercent: config.get('LIMITS_PROBATION_PERCENT'),
          privilegedCidrs: config
            .get('LIMITS_PRIVILEGED_CIDRS')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          privilegedMultiplier: config.get('LIMITS_PRIVILEGED_MULTIPLIER'),
          requestIp: request.ip,
          requestIpPrivileged: isPrivilegedConnection(request.ip, config),
        };
        return reply.send(body);
      },
    );

    app.get(
      '/admin/limits/top',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Users and IPs ranked by requests or limit denials.',
          security: [{ bearerAuth: [] }],
          querystring: topQuery,
        },
      },
      async (request, reply) => {
        const { window, metric, limit } = request.query;
        const ranked = await topConsumers(db, limits.tracker, {
          sinceIso: windowStartIso(new Date(), window === '24h' ? 24 : WEEK_HOURS),
          metric,
          limit,
        });

        const userIds = ranked.filter((r) => r.subjectType === 'user').map((r) => r.subjectId);
        const userRows =
          userIds.length === 0
            ? []
            : await db
                .select({
                  id: users.id,
                  username: users.username,
                  registrationIp: users.registrationIp,
                })
                .from(users)
                .where(inArray(users.id, userIds));
        const userById = new Map(userRows.map((u) => [u.id, u]));

        const ips = new Set<string>();
        for (const u of userRows) if (u.registrationIp) ips.add(u.registrationIp);
        const ipCounts =
          ips.size === 0
            ? []
            : await db
                .select({ ip: users.registrationIp, c: count() })
                .from(users)
                .where(inArray(users.registrationIp, [...ips]))
                .groupBy(users.registrationIp);
        const accountsPerIp = new Map(ipCounts.map((r) => [r.ip ?? '', Number(r.c)]));

        const body: AdminTopConsumersResponse = {
          window,
          metric,
          rows: ranked.map((r) => {
            if (r.subjectType === 'ip') {
              return { ...r, username: null, sharedRegistrationIpCount: 0 };
            }
            const user = userById.get(r.subjectId);
            const shared = user?.registrationIp
              ? (accountsPerIp.get(user.registrationIp) ?? 1) - 1
              : 0;
            return { ...r, username: user?.username ?? null, sharedRegistrationIpCount: shared };
          }),
        };
        return reply.send(body);
      },
    );

    app.get(
      '/admin/limits/overrides',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Every active per-user limit override.',
          security: [{ bearerAuth: [] }],
        },
      },
      async (_request, reply) => {
        const body: AdminLimitOverrideEntry[] = await limits.overrides.listAll();
        return reply.send(body);
      },
    );

    app.get(
      '/admin/users/:id/limits',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'A user’s effective limits, current usage, and recent request history.',
          security: [{ bearerAuth: [] }],
          params: userParams,
        },
      },
      async (request, reply) => {
        const target = await loadTarget(request.params.id);
        if (!target) return reply.status(404).send({ error: 'User not found' });

        const mature = isMatureUser(target.account, config);
        const since = windowStartIso(new Date(), WEEK_HOURS);
        const siblings = target.registrationIp
          ? (await accountsFromIp(target.registrationIp))
              .filter((a) => a.id !== target.account.id)
              .slice(0, SIBLING_LIMIT)
          : [];

        // An unparseable createdAt keeps the account on probation with no known end.
        const endsAt = maturityEndsAt(target.account, config);
        const body: AdminUserLimitsResponse = {
          userId: target.account.id,
          mature,
          probationEndsAt: mature || Number.isNaN(endsAt.getTime()) ? null : endsAt.toISOString(),
          privilegedMultiplier: config.get('LIMITS_PRIVILEGED_MULTIPLIER'),
          rows: await buildRows(target, LIMIT_KEYS),
          registrationIp: target.registrationIp,
          siblingAccounts: siblings,
          requestVolume7d: await userRequestVolume(
            db,
            limits.tracker,
            target.account.id,
            since,
            VOLUME_TOP_N,
          ),
          denials7d: await userDenials(db, limits.tracker, target.account.id, since),
        };
        return reply.send(body);
      },
    );

    app.put(
      '/admin/users/:id/limits/:key',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Override one limit for one user.',
          security: [{ bearerAuth: [] }],
          params: userKeyParams,
          body: setBody,
        },
      },
      async (request, reply) => {
        const check = checkOverridableKey(request.params.key);
        if (!check.ok)
          return reply.status(check.status).send({ code: check.code, message: check.message });

        const ceiling = overrideCeiling(check.key);
        if (ceiling !== undefined && request.body.value > ceiling) {
          return reply.status(400).send({
            code: 'INVALID_LIMIT_VALUE',
            message: `${check.key} overrides may not exceed ${ceiling}.`,
          });
        }

        const target = await loadTarget(request.params.id);
        if (!target) return reply.status(404).send({ error: 'User not found' });

        await limits.overrides.set(
          request.user.id,
          target.account.id,
          check.key,
          request.body.value,
          request.body.note ?? null,
        );
        const [row] = await buildRows(target, [check.key]);
        return reply.send(row);
      },
    );

    app.delete(
      '/admin/users/:id/limits/:key',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Remove a user’s override; the global limit applies again.',
          security: [{ bearerAuth: [] }],
          params: userKeyParams,
        },
      },
      async (request, reply) => {
        const check = checkOverridableKey(request.params.key);
        if (!check.ok)
          return reply.status(check.status).send({ code: check.code, message: check.message });

        const target = await loadTarget(request.params.id);
        if (!target) return reply.status(404).send({ error: 'User not found' });

        await limits.overrides.clear(request.user.id, target.account.id, check.key);
        const [row] = await buildRows(target, [check.key]);
        return reply.send(row);
      },
    );
  };
}

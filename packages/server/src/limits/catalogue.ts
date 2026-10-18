import { LIMIT_KEYS, type LimitKey, type LimitKind } from '@markettrader/shared';
import type { LiveKey } from '../config/registry.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Live options that hold a limit's global value. */
export type LimitConfigKey = Extract<
  LiveKey,
  `LIMIT_${string}` | 'WATCHLIST_MAX_PER_USER' | 'WATCHLIST_MAX_ITEMS'
>;

/** How one limit is counted and resolved. */
export interface LimitDescriptor {
  kind: LimitKind;
  configKey: LimitConfigKey;
  /** Counting window for `rate`/`quota`/`ip`; null for `concurrent`. */
  windowMs: number | null;
  /** Whether accounts on probation get the reduced value. */
  probation: boolean;
  /** Whether an admin may set a per-user override. */
  overridable: boolean;
  /** Subject of the denial message: "{label} limit reached ({max} {per})". */
  label: string;
  per: string;
}

/**
 * Every enforced limit. Adding a `LimitKey` in `shared` without an entry here
 * fails typecheck; adding one also needs a `LIMIT_*` live option and an
 * enforcement point.
 */
export const LIMIT_CATALOGUE = {
  apiRequests: {
    kind: 'rate',
    configKey: 'LIMIT_API_REQUESTS_PER_MINUTE',
    windowMs: MINUTE,
    probation: true,
    overridable: true,
    label: 'Request',
    per: 'per minute',
  },
  trades: {
    kind: 'rate',
    configKey: 'LIMIT_TRADES_PER_MINUTE',
    windowMs: MINUTE,
    probation: true,
    overridable: true,
    label: 'Order placement',
    per: 'per minute',
  },
  orderCancels: {
    kind: 'rate',
    configKey: 'LIMIT_ORDER_CANCELS_PER_MINUTE',
    windowMs: MINUTE,
    probation: true,
    overridable: true,
    label: 'Order cancellation',
    per: 'per minute',
  },
  codeLookups: {
    kind: 'rate',
    configKey: 'LIMIT_CODE_LOOKUPS_PER_MINUTE',
    windowMs: MINUTE,
    probation: true,
    overridable: true,
    label: 'Invite code lookup',
    per: 'per minute',
  },
  wsSubscribes: {
    kind: 'rate',
    configKey: 'LIMIT_WS_SUBSCRIBES_PER_MINUTE',
    windowMs: MINUTE,
    probation: true,
    overridable: true,
    label: 'Live subscription change',
    per: 'per minute',
  },
  gamesCreated: {
    kind: 'quota',
    configKey: 'LIMIT_GAMES_CREATED_PER_WEEK',
    windowMs: 7 * DAY,
    probation: true,
    overridable: true,
    label: 'Game creation',
    per: 'per week',
  },
  activeGamesOwned: {
    kind: 'concurrent',
    configKey: 'LIMIT_ACTIVE_GAMES_OWNED',
    windowMs: null,
    probation: true,
    overridable: true,
    label: 'Active games owned',
    per: 'at once',
  },
  gamesJoined: {
    kind: 'quota',
    configKey: 'LIMIT_GAMES_JOINED_PER_DAY',
    windowMs: DAY,
    probation: true,
    overridable: true,
    label: 'Game join',
    per: 'per day',
  },
  activeGamesJoined: {
    kind: 'concurrent',
    configKey: 'LIMIT_ACTIVE_GAMES_JOINED',
    windowMs: null,
    probation: true,
    overridable: true,
    label: 'Active games joined',
    per: 'at once',
  },
  openOrders: {
    kind: 'concurrent',
    configKey: 'LIMIT_OPEN_ORDERS_PER_PLAYER',
    windowMs: null,
    probation: true,
    overridable: true,
    label: 'Open order',
    per: 'per game',
  },
  watchlists: {
    kind: 'concurrent',
    configKey: 'WATCHLIST_MAX_PER_USER',
    windowMs: null,
    probation: true,
    overridable: true,
    label: 'Watchlist',
    per: 'per user',
  },
  watchlistItems: {
    kind: 'concurrent',
    configKey: 'WATCHLIST_MAX_ITEMS',
    windowMs: null,
    probation: true,
    overridable: true,
    label: 'Watchlist symbol',
    per: 'per list',
  },
  wsConnections: {
    kind: 'concurrent',
    configKey: 'LIMIT_WS_CONNECTIONS_PER_USER',
    windowMs: null,
    // A game page holds two sockets, so 25% of the cap would lock a new
    // player's phone out while their laptop is open.
    probation: false,
    overridable: true,
    label: 'Live connection',
    per: 'at once',
  },
  registrationsPerIp: {
    kind: 'ip',
    configKey: 'LIMIT_REGISTRATIONS_PER_IP_PER_DAY',
    windowMs: DAY,
    probation: false,
    overridable: false,
    label: 'Account registration',
    per: 'per day from this network',
  },
  stockAnalyses: {
    kind: 'quota',
    configKey: 'LIMIT_STOCK_ANALYSES_PER_DAY',
    windowMs: DAY,
    probation: true,
    overridable: true,
    label: 'Stock analysis',
    per: 'per day',
  },
} as const satisfies { [K in LimitKey]: LimitDescriptor };

/** True for a known limit key; prototype names like `toString` are rejected. */
export function isLimitKey(key: string): key is LimitKey {
  return (LIMIT_KEYS as readonly string[]).includes(key);
}

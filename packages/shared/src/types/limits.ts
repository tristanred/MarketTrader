/**
 * Contract for per-user limits: what a denied request returns, and what the
 * admin limits API (`/admin/limits`, `/admin/users/:id/limits`) exchanges.
 */

/** Every limit the server enforces, in display order. */
export const LIMIT_KEYS = [
  'apiRequests',
  'trades',
  'orderCancels',
  'codeLookups',
  'wsSubscribes',
  'gamesCreated',
  'activeGamesOwned',
  'gamesJoined',
  'activeGamesJoined',
  'openOrders',
  'watchlists',
  'watchlistItems',
  'wsConnections',
  'registrationsPerIp',
] as const;

/** Identifier of one enforced limit; the union of {@link LIMIT_KEYS}. */
export type LimitKey = (typeof LIMIT_KEYS)[number];

/**
 * `rate` — requests per sliding window, in memory. `quota` — rows created in a
 * window, counted from the database. `concurrent` — rows or sockets open now.
 * `ip` — keyed by network address, not by user.
 */
export type LimitKind = 'rate' | 'quota' | 'concurrent' | 'ip';

/** Why a user has the limit they have. `probation` = reduced because the account is new. */
export type LimitBasis = 'disabled' | 'admin' | 'override' | 'probation' | 'base';

/** Body of a 429 (rate, quota, ip) or 409 (concurrent) answering a request over its limit. */
export interface LimitExceededBody {
  /** Human-readable, e.g. "Game creation limit reached (3 per week)". */
  error: string;
  code: 'LIMIT_EXCEEDED';
  limit: LimitKey;
  max: number;
  /** True when the max is reduced because the account is still new. */
  probation: boolean;
  /** Days the account stays on probation ("first N days"); present when `probation` is true. */
  maturityDays?: number;
  /** Seconds until one more request would be admitted; also sent as `Retry-After`. */
  retryAfterSeconds?: number;
}

/** `GET /admin/limits/policy` — the global policy plus how the server sees the caller. */
export interface AdminLimitPolicy {
  enabled: boolean;
  maturityDays: number;
  probationPercent: number;
  privilegedCidrs: string[];
  privilegedMultiplier: number;
  /** The caller's `request.ip` — lets an admin confirm the allowlist matches their office. */
  requestIp: string;
  requestIpPrivileged: boolean;
}

/** One limit as it applies to one user, for the admin user page. */
export interface AdminUserLimitRow {
  key: LimitKey;
  label: string;
  kind: LimitKind;
  configKey: string;
  /** The global value before probation, overrides, or multipliers. */
  baseValue: number;
  /** Resolved for a non-privileged connection; null = unlimited. */
  effectiveMax: number | null;
  basis: LimitBasis;
  override: { value: number; note: string | null; updatedBy: string | null; updatedAt: string } | null;
  /** Current usage; null where it cannot be attributed to the user (ip limits, plugin-backed rates, wsSubscribes). */
  used: number | null;
  overridable: boolean;
}

/** Requests one subject sent to one route pattern over a window. */
export interface AdminRouteVolume {
  route: string;
  count: number;
}

/** Denials of one limit for one subject over a window. */
export interface AdminDenialSummary {
  limitKey: string;
  count: number;
  lastAt: string;
}

/** `GET /admin/users/:id/limits`. */
export interface AdminUserLimitsResponse {
  userId: string;
  mature: boolean;
  /** When probation ends; null once mature. */
  probationEndsAt: string | null;
  privilegedMultiplier: number;
  rows: AdminUserLimitRow[];
  /** Null for accounts created before registration IPs were recorded. */
  registrationIp: string | null;
  /** Other accounts registered from the same IP — a sybil signal. */
  siblingAccounts: { id: string; username: string; createdAt: string }[];
  requestVolume7d: AdminRouteVolume[];
  denials7d: AdminDenialSummary[];
}

/** Body of `PUT /admin/users/:id/limits/:key`. */
export interface AdminSetUserLimitRequest {
  value: number;
  note?: string;
}

/** One active per-user override, for `GET /admin/limits/overrides`. */
export interface AdminLimitOverrideEntry {
  userId: string;
  username: string;
  key: LimitKey;
  value: number;
  note: string | null;
  /** Admin user id that last wrote it; null when unknown. */
  updatedBy: string | null;
  /** That admin's username; null if the account no longer exists. */
  updatedByUsername: string | null;
  updatedAt: string;
}

/** One row of the top-consumers table. */
export interface AdminTopConsumer {
  subjectType: 'user' | 'ip';
  subjectId: string;
  username: string | null;
  count: number;
  /** Busiest route (requests) or most-denied limit (denials). */
  top: string | null;
  /** Other accounts sharing this user's registration IP; 0 for ip subjects. */
  sharedRegistrationIpCount: number;
}

/** `GET /admin/limits/top`. */
export interface AdminTopConsumersResponse {
  window: '24h' | '7d';
  metric: 'requests' | 'denials';
  rows: AdminTopConsumer[];
}

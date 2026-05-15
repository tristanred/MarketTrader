/**
 * Admin API request/response types. Every endpoint under `/admin/*` requires
 * the caller to be a member of the `admin` group.
 */

/** Currently the only group; left as a string union so adding more is trivial. */
export type GroupName = 'admin';

/** Categories tracked in the admin audit log. */
export type AdminAuditTargetType = 'user' | 'game' | 'trade' | 'portfolio' | 'system';

/** One row of the audit log as returned by GET /admin/audit. */
export interface AdminAuditEntry {
  id: string;
  adminUserId: string;
  adminUsername: string | null;
  action: string;
  targetType: AdminAuditTargetType;
  targetId: string | null;
  /** Parsed JSON (null if absent). */
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

/** Body returned with 409 when a destructive action has dependents. */
export interface AdminDependentCounts {
  workingOrders?: number;
  pendingOrders?: number;
  executedTrades?: number;
  holdings?: number;
  players?: number;
  ownedGames?: number;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AdminUserSummary {
  id: string;
  username: string;
  disabled: boolean;
  createdAt: string;
  groups: GroupName[];
}

export interface AdminUserDetail extends AdminUserSummary {
  gamesPlayed: number;
  gamesOwned: number;
  tradeCount: number;
}

export interface AdminListUsersResponse {
  users: AdminUserSummary[];
  total: number;
}

export interface AdminUpdateUserRequest {
  username?: string;
  disabled?: boolean;
}

export interface AdminResetPasswordRequest {
  newPassword: string;
}

// ─── Games ────────────────────────────────────────────────────────────────────

export interface AdminGameSummary {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'ended';
  startDate: string;
  endDate: string;
  startingBalance: number;
  createdBy: string;
  playerCount: number;
  createdAt: string;
}

export interface AdminListGamesResponse {
  games: AdminGameSummary[];
  total: number;
}

export interface AdminUpdateGameRequest {
  name?: string;
  startDate?: string;
  endDate?: string;
  startingBalance?: number;
  allowShortSelling?: boolean;
  allowLimitOrders?: boolean;
  allowStopOrders?: boolean;
  allowBracketOrders?: boolean;
  allowGTC?: boolean;
}

export interface AdminTransferGameOwnerRequest {
  newOwnerId: string;
}

export interface AdminSetGameStatusRequest {
  status: 'pending' | 'active' | 'ended';
}

export interface AdminAddPlayerRequest {
  userId: string;
}

// ─── Portfolios / cash / holdings ─────────────────────────────────────────────

export interface AdminUpdateCashRequest {
  cashBalance: number;
  reason?: string;
}

export interface AdminAdjustHoldingsRequest {
  symbol: string;
  /** Positive to add shares, negative to remove. Refuses delta + existing < 0. */
  quantityDelta: number;
  /** Cost basis to record for newly-added shares. Required when quantityDelta > 0 and no existing row. */
  costBasis?: number;
  reason?: string;
}

// ─── Trades ───────────────────────────────────────────────────────────────────

export interface AdminForceExecuteTradeRequest {
  /** Override the fill price. Defaults to the latest quote when omitted. */
  price?: number;
}

export interface AdminEditTradePriceRequest {
  price: number;
}

// ─── System ───────────────────────────────────────────────────────────────────

export interface AdminMarketOverrideRequest {
  /** Null clears any override and reverts to the real market clock. */
  override: 'open' | 'closed' | null;
}

export interface AdminSetStockPriceRequest {
  price: number;
  change?: number;
  changePercent?: number;
}

export interface AdminStatsResponse {
  websocketConnections: number;
  rowCounts: Record<string, number>;
  uptimeSeconds: number;
}

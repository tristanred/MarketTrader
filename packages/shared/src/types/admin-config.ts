/**
 * Contract for the admin configuration panel (`/admin/config`). Every option the
 * server reads from its environment is described by one {@link AdminConfigEntry}.
 */

/** A configuration value as it crosses the wire. */
export type ConfigValue = string | number | boolean;

/** Grouping used by the panel; one card per category. */
export type ConfigCategory =
  | 'core'
  | 'security'
  | 'database'
  | 'stock-data'
  | 'market-hours'
  | 'workers'
  | 'limits'
  | 'websocket'
  | 'observability'
  | 'analytics';

/** How the panel renders and validates a value. */
export type ConfigKind = 'string' | 'integer' | 'boolean' | 'enum';

/** `live` options can be overridden at runtime; `restart` options are read once at boot. */
export type ConfigMutability = 'live' | 'restart';

/** Where the effective value came from: built-in default, the process environment, or an admin override. */
export type ConfigValueSource = 'default' | 'env' | 'override';

/** An active admin override of a live option. */
export interface AdminConfigOverride {
  value: ConfigValue;
  updatedAt: string;
  /** Username of the admin who set it; null if that account no longer exists. */
  updatedBy: string | null;
}

/** One option as returned by `GET /admin/config`. */
export interface AdminConfigEntry {
  key: string;
  /** Variable names read, in precedence order — more than one only for legacy aliases. */
  envVars: string[];
  category: ConfigCategory;
  description: string;
  kind: ConfigKind;
  unit: 'ms' | null;
  /** Allowed values for `enum` kinds; null otherwise. */
  options: string[] | null;
  /** Inclusive override bounds for live `integer` kinds; null otherwise. */
  min: number | null;
  max: number | null;
  mutability: ConfigMutability;
  /** Why a `restart` option cannot change live; null for live options. */
  restartReason: string | null;
  /** When true, `bootValue`/`effectiveValue` are always null — only `isSet` is reported. */
  secret: boolean;
  /** Whether a non-empty value is configured. */
  isSet: boolean;
  source: ConfigValueSource;
  /** What the process booted with (environment or default). URL credentials are masked. */
  bootValue: ConfigValue | null;
  /** What the server uses right now: the override if one is active, else `bootValue`. */
  effectiveValue: ConfigValue | null;
  override: AdminConfigOverride | null;
}

/** Response of `GET /admin/config`, entries in registry order (grouped by category). */
export interface AdminConfigResponse {
  entries: AdminConfigEntry[];
}

/** Body of `PUT /admin/config/:key`. The value's JSON type must match the option's kind. */
export interface AdminSetConfigRequest {
  value: ConfigValue;
}

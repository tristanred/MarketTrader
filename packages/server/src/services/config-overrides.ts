import { eq, like } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AdminConfigEntry, ConfigValue } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { env } from '../env.js';
import {
  CONFIG_REGISTRY,
  descriptorFor,
  isExplicitlySet,
  isLiveKey,
  liveValueSchema,
  type EnvKey,
  type LiveConfigValues,
  type LiveKey,
} from '../config/registry.js';
import { redactConfigUrl } from '../config/redact.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import { recordAdminAction } from './admin-audit.js';

/** `system_settings` key prefix for persisted overrides: `config.override.<KEY>`. */
export const CONFIG_OVERRIDE_PREFIX = 'config.override.';

interface OverrideRow {
  key: string;
  value: string;
  updatedAt: string;
  updatedBy: string | null;
  username: string | null;
}

type Parsed =
  | { ok: true; key: LiveKey; value: LiveConfigValues[LiveKey] }
  | { ok: false; reason: string };

function parseRow(row: Pick<OverrideRow, 'key' | 'value'>): Parsed {
  const key = row.key.slice(CONFIG_OVERRIDE_PREFIX.length);
  if (!isLiveKey(key)) return { ok: false, reason: 'not a live-editable option' };
  let stored: unknown;
  try {
    stored = JSON.parse(row.value);
  } catch {
    return { ok: false, reason: 'value is not valid JSON' };
  }
  if (typeof stored !== 'object' || stored === null || !('value' in stored)) {
    return { ok: false, reason: 'value has no "value" field' };
  }
  const result = liveValueSchema(key).safeParse(stored.value);
  if (!result.success) return { ok: false, reason: result.error.issues.map((i) => i.message).join('; ') };
  return { ok: true, key, value: result.data };
}

/**
 * Persists admin overrides of live options in `system_settings` and keeps one
 * app's {@link RuntimeConfig} in step with them. Audits in the same transaction
 * as the write and touches the config only after commit. Rows that no longer
 * validate (renamed key, tightened bounds) are ignored, never fatal.
 */
export class ConfigOverridesService {
  constructor(
    private readonly db: Db,
    private readonly config: RuntimeConfig,
  ) {}

  /** Makes the config's overrides exactly the valid persisted rows. Returns the keys applied. */
  async load(logger?: Pick<FastifyBaseLogger, 'warn'>): Promise<LiveKey[]> {
    const valid: Extract<Parsed, { ok: true }>[] = [];
    for (const row of await this.readRows()) {
      const parsed = parseRow(row);
      if (parsed.ok) valid.push(parsed);
      else logger?.warn({ key: row.key, reason: parsed.reason }, 'ignoring invalid runtime config override');
    }
    this.config.clearAll();
    for (const { key, value } of valid) this.config.set(key, value);
    return valid.map((p) => p.key);
  }

  /** Every option in registry order, with secrets reduced to `isSet`. */
  async list(): Promise<AdminConfigEntry[]> {
    const rows = new Map((await this.readRows()).map((r) => [r.key, r]));
    return (Object.keys(CONFIG_REGISTRY) as EnvKey[]).map((key) =>
      this.toEntry(key, rows.get(CONFIG_OVERRIDE_PREFIX + key)),
    );
  }

  /** One option as {@link list} reports it. */
  async get(key: EnvKey): Promise<AdminConfigEntry> {
    const [row] = await this.readRows(key);
    return this.toEntry(key, row);
  }

  /** Persists and applies an override. `value` must already satisfy `liveValueSchema(key)`. */
  async set<K extends LiveKey>(key: K, value: LiveConfigValues[K], actorId: string): Promise<AdminConfigEntry> {
    const before = this.config.get(key);
    const stored = JSON.stringify({ value });
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.systemSettings)
        .values({ key: CONFIG_OVERRIDE_PREFIX + key, value: stored, updatedAt: now, updatedBy: actorId })
        .onConflictDoUpdate({
          target: schema.systemSettings.key,
          set: { value: stored, updatedAt: now, updatedBy: actorId },
        });
      await recordAdminAction(tx, {
        adminUserId: actorId,
        action: 'system.config.override',
        targetType: 'system',
        targetId: key,
        before: { value: before },
        after: { value },
      });
    });
    this.config.set(key, value);
    return this.get(key);
  }

  /** Removes an override so the boot value applies again. Idempotent; audits only a real removal. */
  async reset(key: LiveKey, actorId: string): Promise<AdminConfigEntry> {
    const before = this.config.get(key);
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(schema.systemSettings)
        .where(eq(schema.systemSettings.key, CONFIG_OVERRIDE_PREFIX + key))
        .returning({ key: schema.systemSettings.key });
      if (removed.length === 0) return;
      await recordAdminAction(tx, {
        adminUserId: actorId,
        action: 'system.config.reset',
        targetType: 'system',
        targetId: key,
        before: { value: before },
        after: { value: this.config.bootValue(key) },
      });
    });
    this.config.clear(key);
    return this.get(key);
  }

  private async readRows(key?: EnvKey): Promise<OverrideRow[]> {
    const { systemSettings, users } = schema;
    return this.db
      .select({
        key: systemSettings.key,
        value: systemSettings.value,
        updatedAt: systemSettings.updatedAt,
        updatedBy: systemSettings.updatedBy,
        username: users.username,
      })
      .from(systemSettings)
      .leftJoin(users, eq(users.id, systemSettings.updatedBy))
      .where(
        key === undefined
          ? like(systemSettings.key, `${CONFIG_OVERRIDE_PREFIX}%`)
          : eq(systemSettings.key, CONFIG_OVERRIDE_PREFIX + key),
      );
  }

  private toEntry(key: EnvKey, row: OverrideRow | undefined): AdminConfigEntry {
    const d = descriptorFor(key);
    const parsed = row ? parseRow(row) : null;
    const override =
      row && parsed?.ok ? { value: parsed.value, updatedAt: row.updatedAt, updatedBy: row.username } : null;
    const boot: ConfigValue = isLiveKey(key) ? this.config.bootValue(key) : env[key];
    const effective: ConfigValue = isLiveKey(key) ? this.config.get(key) : boot;
    const show = (v: ConfigValue): ConfigValue | null =>
      d.secret ? null : d.redactUrl && typeof v === 'string' ? redactConfigUrl(v) : v;

    return {
      key,
      envVars: [...(d.envVars ?? [key])],
      category: d.category,
      description: d.description,
      kind: d.kind,
      unit: d.unit ?? null,
      options: d.options ? [...d.options] : null,
      min: d.mutability === 'live' ? (d.min ?? null) : null,
      max: d.mutability === 'live' ? (d.max ?? null) : null,
      mutability: d.mutability,
      restartReason: d.mutability === 'restart' ? d.restartReason : null,
      secret: d.secret ?? false,
      // TRUST_PROXY=false is how an operator says "no proxy", so it reads as unset.
      isSet: boot !== '' && boot !== false,
      source: override ? 'override' : isExplicitlySet(key) ? 'env' : 'default',
      bootValue: show(boot),
      effectiveValue: show(effective),
      override,
    };
  }
}

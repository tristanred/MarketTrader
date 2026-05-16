import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { TickerTapeSettings } from '@markettrader/shared';

const KEY_TICKER_TAPE = 'ticker_tape_symbols' as const;

/** The default tape seeded on first boot. Mixed indices + major stocks. */
export const DEFAULT_TICKER_TAPE_SYMBOLS = [
  '^GSPC',
  '^IXIC',
  '^DJI',
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  'AMZN',
  'META',
  'GOOGL',
] as const;

interface PersistedTape {
  symbols: string[];
}

/**
 * Manages runtime configuration persisted in {@link schema.systemSettings}.
 * Phase 2 only exposes the ticker-tape key; the service is structured so
 * additional keys (admin-broadcast banners, feature flags) can be added in
 * later phases without rewriting the API.
 *
 * Emits a `'change'` event with the new symbol array after every successful
 * write — both `ensureSeeded` on first boot and `setTickerTapeSymbols` on
 * admin updates. Consumed by `indicesBroadcaster` to refresh its
 * subscription set without polling.
 */
export class SystemSettingsService extends EventEmitter {
  constructor(private readonly db: Db) {
    super();
  }

  /** Returns the current ticker-tape config, or `null` if it has not been seeded. */
  async getTickerTapeSymbols(): Promise<TickerTapeSettings | null> {
    const [row] = await this.db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, KEY_TICKER_TAPE))
      .limit(1);

    if (!row) return null;

    const parsed = JSON.parse(row.value) as PersistedTape;
    return {
      symbols: parsed.symbols,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Inserts the default tape if and only if no row exists for the key.
   * Called once at server boot. Subsequent admin edits won't be overwritten.
   */
  async ensureSeeded(): Promise<void> {
    const existing = await this.getTickerTapeSymbols();
    if (existing) return;

    await this.db.insert(schema.systemSettings).values({
      key: KEY_TICKER_TAPE,
      value: JSON.stringify({ symbols: [...DEFAULT_TICKER_TAPE_SYMBOLS] }),
      updatedBy: null,
    });
    this.emit('change', [...DEFAULT_TICKER_TAPE_SYMBOLS]);
  }

  /**
   * Replaces the persisted ticker-tape symbol list using the top-level db
   * handle. For atomic admin writes that also touch the audit log, use
   * {@link setTickerTapeSymbolsInTx} so both rows land in the same
   * transaction.
   */
  async setTickerTapeSymbols(symbols: string[], actorId: string | null): Promise<void> {
    return this.setTickerTapeSymbolsInTx(this.db, symbols, actorId);
  }

  /**
   * Transaction-aware variant of {@link setTickerTapeSymbols}. The caller
   * passes its own tx handle so the write and any related audit entry
   * commit atomically. The 'change' event fires after the inner write
   * completes — callers should avoid irreversible side effects in
   * 'change' listeners, since the surrounding transaction may still roll
   * back.
   */
  async setTickerTapeSymbolsInTx(
    db: Pick<Db, 'insert'>,
    symbols: string[],
    actorId: string | null,
  ): Promise<void> {
    const normalized = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (normalized.length === 0) {
      throw new Error('ticker_tape_symbols cannot be empty');
    }

    const value = JSON.stringify({ symbols: normalized });
    const now = new Date().toISOString();

    await db
      .insert(schema.systemSettings)
      .values({ key: KEY_TICKER_TAPE, value, updatedAt: now, updatedBy: actorId })
      .onConflictDoUpdate({
        target: schema.systemSettings.key,
        set: { value, updatedAt: now, updatedBy: actorId },
      });

    this.emit('change', normalized);
  }
}

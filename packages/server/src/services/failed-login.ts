import { env } from '../env.js';

/** Tuning for {@link FailedLoginTracker}; each field falls back to its `LOGIN_*` env var. */
export interface FailedLoginOptions {
  /** Consecutive failures within {@link FailedLoginOptions.windowMs} before the throttle engages. */
  maxAttempts?: number;
  /** Failures older than this stop counting. */
  windowMs?: number;
  /** How long the throttle holds once it engages. */
  lockoutMs?: number;
  /** When true, every method is a no-op. Tests and the e2e suite. */
  disabled?: boolean;
}

interface Entry {
  failures: number;
  /** Timestamp of the most recent failure; the window is measured from here. */
  lastFailureAt: number;
  /** Epoch ms the throttle expires, or 0 when not engaged. */
  lockedUntil: number;
}

/**
 * Beyond this many tracked usernames, expired entries are swept before a new one
 * is admitted. Bounded because failures are recorded for names that do not exist:
 * without a ceiling, enumerating usernames would grow the map without limit.
 */
const MAX_TRACKED = 5000;

/**
 * How far below {@link MAX_TRACKED} a sweep evicts down to. Reclaiming in one
 * batch amortizes the sort: trimming to exactly the cap would re-sort the whole
 * map on every subsequent new username, which is the hot path under the
 * enumeration attack the cap exists to survive.
 */
const SWEEP_TARGET = Math.floor(MAX_TRACKED * 0.9);

/**
 * Per-account throttle for `POST /auth/login`, counting consecutive failures by
 * username rather than by source address.
 *
 * The per-IP rate limit it backs up is only as sound as `request.ip`, which
 * depends on correct proxy configuration; this control does not depend on
 * network identity at all, so rotating source addresses does not evade it.
 *
 * State is per-process and in-memory — see the same trade-off in
 * {@link ../providers/cached-provider.js}. A restart clears it, and it is not
 * shared between instances. Both deployment paths run a single process.
 */
export class FailedLoginTracker {
  private readonly entries = new Map<string, Entry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;
  private readonly disabled: boolean;

  constructor(opts: FailedLoginOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? env.LOGIN_MAX_FAILED_ATTEMPTS;
    this.windowMs = opts.windowMs ?? env.LOGIN_FAILURE_WINDOW_MS;
    this.lockoutMs = opts.lockoutMs ?? env.LOGIN_LOCKOUT_MS;
    this.disabled = opts.disabled ?? false;
  }

  /**
   * Milliseconds until `username` may attempt again, or `null` when not throttled.
   * Callers should surface this as a 429 with a `Retry-After` header.
   */
  retryAfterMs(username: string): number | null {
    if (this.disabled) return null;
    const entry = this.entries.get(username);
    if (!entry) return null;

    const now = Date.now();
    if (entry.lockedUntil > now) return entry.lockedUntil - now;

    // Lockout served, or the window lapsed with the threshold unmet.
    if (entry.lockedUntil !== 0 || now - entry.lastFailureAt >= this.windowMs) {
      this.entries.delete(username);
    }
    return null;
  }

  /**
   * Records one failed attempt. Returns true if this attempt engaged the throttle,
   * so the caller can log the transition once rather than on every subsequent hit.
   *
   * Called for unknown usernames too — behaving differently for them would turn
   * the throttle into an account-existence oracle.
   */
  recordFailure(username: string): boolean {
    if (this.disabled) return false;
    const now = Date.now();

    const existing = this.entries.get(username);
    const withinWindow = existing !== undefined && now - existing.lastFailureAt < this.windowMs;
    const failures = withinWindow ? existing.failures + 1 : 1;

    if (existing === undefined && this.entries.size >= MAX_TRACKED) {
      this.sweep(now);
    }

    const engaged = failures >= this.maxAttempts;
    this.entries.set(username, {
      failures,
      lastFailureAt: now,
      lockedUntil: engaged ? now + this.lockoutMs : 0,
    });

    return engaged && !(existing !== undefined && existing.lockedUntil > now);
  }

  /** Clears the counter after a successful authentication. */
  reset(username: string): void {
    this.entries.delete(username);
  }

  /**
   * Drops entries that are neither locked nor still inside their failure window.
   * If that frees nothing, evicts the least recently failed entries instead — an
   * attacker able to keep MAX_TRACKED names hot should not also be able to grow
   * the map without bound.
   *
   * Currently-locked entries are evicted last. Without that ordering, flooding
   * the map with junk usernames would push a locked account out and release its
   * lockout, turning the bound into a way around the control it protects.
   */
  private sweep(now: number): void {
    for (const [username, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.lastFailureAt >= this.windowMs) {
        this.entries.delete(username);
      }
    }
    if (this.entries.size <= SWEEP_TARGET) return;

    const evictionOrder = [...this.entries.entries()].sort((a, b) => {
      const aLocked = a[1].lockedUntil > now;
      const bLocked = b[1].lockedUntil > now;
      if (aLocked !== bLocked) return aLocked ? 1 : -1;
      return a[1].lastFailureAt - b[1].lastFailureAt;
    });
    for (const [username] of evictionOrder.slice(0, this.entries.size - SWEEP_TARGET)) {
      this.entries.delete(username);
    }
  }
}

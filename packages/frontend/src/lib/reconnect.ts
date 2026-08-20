/** First backoff delay, before jitter. */
export const RECONNECT_BASE_MS = 1_000;
/** Ceiling on the exponential curve, before jitter. */
export const RECONNECT_MAX_MS = 30_000;
/** How long a socket must stay open before it counts as healthy. */
export const RECONNECT_STABLE_MS = 30_000;
/** Consecutive attempts allowed before the controller gives up and waits for a resume. */
export const RECONNECT_MAX_ATTEMPTS = 10;

export interface ReconnectControllerOptions {
  baseMs?: number;
  maxMs?: number;
  stableMs?: number;
  maxAttempts?: number;
  /** Injectable jitter source; defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Backoff policy for a self-healing WebSocket: exponential growth, jitter, a
 * ceiling, and a hard stop after {@link RECONNECT_MAX_ATTEMPTS} tries.
 *
 * The attempt counter is cleared only once a connection has stayed open for
 * `stableMs` — resetting it on open instead would pin a socket that opens and
 * drops immediately to the base delay forever, which is the reconnect storm
 * this class exists to prevent.
 */
export class ReconnectController {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly stableMs: number;
  private readonly maxAttempts: number;
  private readonly random: () => number;

  private attempts = 0;
  private reconnectTimer: number | null = null;
  private stabilityTimer: number | null = null;

  constructor(options: ReconnectControllerOptions = {}) {
    this.baseMs = options.baseMs ?? RECONNECT_BASE_MS;
    this.maxMs = options.maxMs ?? RECONNECT_MAX_MS;
    this.stableMs = options.stableMs ?? RECONNECT_STABLE_MS;
    this.maxAttempts = options.maxAttempts ?? RECONNECT_MAX_ATTEMPTS;
    this.random = options.random ?? Math.random;
  }

  /** Consecutive attempts since the last connection proved itself stable. */
  get attempt(): number {
    return this.attempts;
  }

  /** True once the attempt budget is spent; only {@link reset} clears it. */
  get exhausted(): boolean {
    return this.attempts >= this.maxAttempts;
  }

  /** Call when the socket opens: arms the timer that marks it healthy. */
  markOpen(): void {
    this.clearStabilityTimer();
    this.stabilityTimer = window.setTimeout(() => {
      this.stabilityTimer = null;
      this.attempts = 0;
    }, this.stableMs);
  }

  /**
   * Call when the socket closes. Schedules `connect` after a jittered backoff
   * delay and returns that delay, or returns null when the attempt budget is
   * spent — in which case the caller should surface a retry affordance rather
   * than keep looping.
   */
  scheduleReconnect(connect: () => void): number | null {
    this.clearStabilityTimer();
    this.clearReconnectTimer();
    if (this.exhausted) return null;

    this.attempts += 1;
    const ceiling = Math.min(this.baseMs * 2 ** (this.attempts - 1), this.maxMs);
    // Jitter into [ceiling/2, ceiling] so clients don't retry in lockstep after
    // a deploy or restart.
    const delay = Math.round(ceiling * (0.5 + this.random() * 0.5));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      connect();
    }, delay);
    return delay;
  }

  /** Drops every pending timer, keeping the attempt counter. */
  cancel(): void {
    this.clearReconnectTimer();
    this.clearStabilityTimer();
  }

  /** Drops every pending timer and clears the attempt counter. */
  reset(): void {
    this.cancel();
    this.attempts = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer !== null) {
      window.clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }
}

/**
 * Calls `resume` on the two signals that mean "a give-up state is worth
 * re-testing": the browser regaining connectivity, and a background tab coming
 * back to the foreground. Returns a detach function.
 */
export function attachResumeListeners(resume: () => void): () => void {
  const onVisible = () => {
    if (!document.hidden) resume();
  };
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

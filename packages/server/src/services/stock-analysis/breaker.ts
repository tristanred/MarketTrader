import type { LlmError, LlmErrorCode } from '../../providers/llm/interface.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long each account-level failure pauses the feature when the upstream gives no delay. */
const DEFAULT_PAUSE_MS: Partial<Record<LlmErrorCode, number>> = {
  AUTH: HOUR,
  NO_CREDITS: 15 * MINUTE,
  SPEND_LIMIT: HOUR,
  RATE_LIMITED: MINUTE,
  BAD_REQUEST: 15 * MINUTE,
};

/** A suggested delay is trusted only up to a day, so a bogus `resets_at` cannot park the feature. */
const MAX_PAUSE_MS = 24 * HOUR;

/**
 * Process-wide pause for stock analysis, opened by an account-level upstream
 * failure (bad key, no credits, spend limit, rate limit). Without it every user
 * would discover the same outage by spending a request on it. Same idea as
 * `YahooProvider.trip429`; exact only within one process.
 *
 * Two independent pauses: an account-wide one, and one tied to the model that
 * caused a `BAD_REQUEST` (an admin fixing `ANALYSIS_MODEL` lifts it). Neither can
 * shorten or lift the other.
 */
export class AnalysisBreaker {
  private accountUntil = 0;
  private modelPause: { model: string; until: number } | undefined;

  /** Opens the breaker for `err`, keeping the later of an existing and the new deadline. */
  open(err: LlmError, model: string, now: number = Date.now()): void {
    const fallback = DEFAULT_PAUSE_MS[err.code] ?? MINUTE;
    const until = now + Math.min(Math.max(err.retryAfterMs ?? fallback, 1_000), MAX_PAUSE_MS);
    if (err.code === 'BAD_REQUEST') {
      const current = this.modelPause?.model === model ? this.modelPause.until : 0;
      this.modelPause = { model, until: Math.max(current, until) };
    } else {
      this.accountUntil = Math.max(this.accountUntil, until);
    }
  }

  /** When the breaker closes for `model`, or undefined when it is closed now. */
  openUntil(model: string, now: number = Date.now()): number | undefined {
    const modelUntil = this.modelPause?.model === model ? this.modelPause.until : 0;
    const until = Math.max(this.accountUntil, modelUntil);
    return until > now ? until : undefined;
  }

  /** Closes the breaker; for tests and an admin reset. */
  reset(): void {
    this.accountUntil = 0;
    this.modelPause = undefined;
  }
}

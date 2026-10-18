/**
 * Contract for LLM stock analysis (`/stocks/:symbol/analysis`). An analysis is
 * position-independent, so one cached result is shared by every user.
 */

/** The model's call on a stock. `SELL` reads as "sell if you hold it". */
export type AnalysisVerdict = 'BUY' | 'HOLD' | 'SELL';

/** One analysis as shown to a user. */
export interface StockAnalysis {
  symbol: string;
  verdict: AnalysisVerdict;
  /** Integer 0–100: how strongly the supplied data supports the verdict. */
  confidence: number;
  summary: string;
  bullPoints: string[];
  bearPoints: string[];
  /** ISO 8601 UTC. */
  generatedAt: string;
  /** Model that actually answered (a router may pick one per call); null if unreported. */
  reportedModel: string | null;
  /** Last price, USD, in the data the model was given. */
  priceAtAnalysis: number;
}

/** The caller's daily allowance of fresh analyses. `limit`/`remaining` are null when unlimited. */
export interface AnalysisUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
  /** True while the account is new and gets a reduced allowance. */
  probation: boolean;
  /** ISO time the oldest counted analysis stops counting; null when none is counted. */
  nextSlotAt: string | null;
}

/** `GET /stocks/:symbol/analysis/status` — what the Analyze button needs before a click. */
export interface StockAnalysisStatus {
  /** False when the server has no LLM configured; the button is hidden. */
  enabled: boolean;
  /** False while the upstream is paused (credits, rate limit, capacity); cached results still work. */
  available: boolean;
  /** ISO time the pause is expected to lift; null when available or unknown. */
  retryAt: string | null;
  /** Whether a fresh cached analysis exists for this symbol (viewing it is free). */
  cached: boolean;
  /** True while a generation for this symbol is running; poll until it turns false. */
  generating: boolean;
  /** The most recent generation failure for this symbol in the last few minutes, if any. */
  lastFailure: AnalysisFailure | null;
  usage: AnalysisUsage;
}

/** A generation that failed after its request returned 202, reported through the status endpoint. */
export interface AnalysisFailure extends AnalysisErrorBody {
  /** ISO 8601 UTC. Compare with when you started polling to ignore an older failure. */
  failedAt: string;
}

/**
 * `POST /stocks/:symbol/analysis` 202 body: the model is still working. Poll the
 * status endpoint until `cached` (then POST again — a free cache hit) or `lastFailure`.
 */
export interface StockAnalysisPending {
  status: 'generating';
  usage: AnalysisUsage;
}

/** Where a returned analysis came from. `shared` = joined another user's in-flight generation. */
export type AnalysisSource = 'generated' | 'cache' | 'shared';

/** `POST /stocks/:symbol/analysis` success body. */
export interface StockAnalysisResponse {
  analysis: StockAnalysis;
  source: AnalysisSource;
  usage: AnalysisUsage;
}

/** Error `code` values the analysis endpoints return besides the shared `LIMIT_EXCEEDED`. */
export type AnalysisErrorCode =
  | 'ANALYSIS_DISABLED'
  | 'ANALYSIS_UNAVAILABLE'
  | 'ANALYSIS_CAPACITY'
  | 'ANALYSIS_IN_PROGRESS'
  | 'ANALYSIS_FAILED'
  | 'ANALYSIS_TIMEOUT';

/** Body of a non-limit analysis refusal or failure. */
export interface AnalysisErrorBody {
  error: string;
  code: AnalysisErrorCode;
  /** Seconds until a retry can succeed, when known; mirrors `Retry-After`. */
  retryAfterSeconds?: number;
}

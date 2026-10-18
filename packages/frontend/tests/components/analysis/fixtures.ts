import type {
  AnalysisUsage,
  StockAnalysis,
  StockAnalysisResponse,
  StockAnalysisStatus,
} from '@markettrader/shared';

export function usage(over: Partial<AnalysisUsage> = {}): AnalysisUsage {
  return { limit: 10, used: 3, remaining: 7, probation: false, nextSlotAt: null, ...over };
}

export function status(over: Partial<StockAnalysisStatus> = {}): StockAnalysisStatus {
  return {
    enabled: true,
    available: true,
    retryAt: null,
    cached: false,
    generating: false,
    lastFailure: null,
    usage: usage(),
    ...over,
  };
}

export function analysis(over: Partial<StockAnalysis> = {}): StockAnalysis {
  return {
    symbol: 'AAPL',
    verdict: 'BUY',
    confidence: 78,
    summary: 'Services growth and margin expansion outweigh a stretched valuation.',
    bullPoints: ['Services revenue +14% y/y', 'Above 50/200-day averages'],
    bearPoints: ['Forward P/E 31, above 5-y avg', 'Earnings in 9 days'],
    generatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    reportedModel: 'meta-llama/llama-3.3-70b-instruct',
    priceAtAnalysis: 231.4,
    ...over,
  };
}

export function response(over: Partial<StockAnalysisResponse> = {}): StockAnalysisResponse {
  return {
    analysis: analysis(),
    source: 'generated',
    usage: usage({ used: 4, remaining: 6 }),
    ...over,
  };
}

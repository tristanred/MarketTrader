import { meters } from '../packages/server/src/observability/telemetry';

// GOOD (out of scope): test code is never flagged.
export function t(request: any) {
  meters.tradesExecuted.add(1, { symbol: request.body.symbol });
}

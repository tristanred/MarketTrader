import { metrics, trace } from '@opentelemetry/api';
import { buildInfo } from '../build-info.js';

const SCOPE = 'markettrader';

/**
 * Tracer for hand-written spans. Covers what no instrumentation reaches:
 * trade execution, upstream provider calls, and background worker ticks.
 *
 * Safe to resolve at module load — `trace.getTracer` hands back a `ProxyTracer`
 * that re-resolves once a real provider is registered. The metrics API has no
 * such proxy, which is why {@link meters} below has to work differently.
 */
export const tracer = trace.getTracer(SCOPE, buildInfo.version);

/**
 * Domain metrics. Instrument names are the OTel dotted form; Prometheus renders
 * them with underscores (`markettrader.trades.executed` becomes
 * `markettrader_trades_executed_total`).
 *
 * Symbols are deliberately absent from every attribute set — the symbol universe
 * is unbounded and would blow up cardinality. Symbols belong on spans, which are
 * not aggregated.
 */
function buildInstruments() {
  const meter = metrics.getMeter(SCOPE, buildInfo.version);

  return {
    tradesExecuted: meter.createCounter('markettrader.trades.executed', {
      description: 'Trades filled, by side and fill mode (immediate/resting)',
    }),
    tradeDuration: meter.createHistogram('markettrader.trade.duration', {
      description: 'End-to-end trade execution time',
      unit: 'ms',
    }),
    tradesRejected: meter.createCounter('markettrader.trades.rejected', {
      description: 'Trade attempts refused, by reason code',
    }),

    providerRequests: meter.createCounter('markettrader.provider.requests', {
      description: 'Upstream stock-provider calls, by operation and outcome',
    }),
    providerDuration: meter.createHistogram('markettrader.provider.duration', {
      description: 'Upstream stock-provider call latency',
      unit: 'ms',
    }),
    quoteCacheLookups: meter.createCounter('markettrader.quote_cache.lookups', {
      description: 'Quote cache reads, by result (hit/miss/stale)',
    }),

    wsClients: meter.createUpDownCounter('markettrader.ws.clients', {
      description: 'Currently connected WebSocket clients, by registry scope',
    }),

    workerTicks: meter.createCounter('markettrader.worker.ticks', {
      description: 'Background worker ticks, by worker and outcome',
    }),
    workerDuration: meter.createHistogram('markettrader.worker.duration', {
      description: 'Background worker tick duration',
      unit: 'ms',
    }),
    pendingOrdersSettled: meter.createCounter('markettrader.pending_orders.settled', {
      description: 'Resting orders resolved by the settlement worker, by outcome',
    }),

    achievementsUnlocked: meter.createCounter('markettrader.achievements.unlocked', {
      description: 'Achievement unlocks, by achievement key and rarity',
    }),
    eventsEmitted: meter.createCounter('markettrader.events.emitted', {
      description: 'Domain events published on the in-process bus, by type',
    }),
  };
}

type Instruments = ReturnType<typeof buildInstruments>;

let instruments: Instruments | undefined;

/**
 * The metric instruments, created on first use rather than at module load.
 *
 * This is not premature laziness — it is required. `metrics.getMeter()` returns
 * whatever provider is registered *at call time*, and unlike the trace API there
 * is no proxy that back-fills a real provider later. Since this module is
 * imported through `app.ts` before `initTelemetry()` runs, building the
 * instruments eagerly binds every one of them to the no-op meter for the life of
 * the process, and every metric silently reads zero.
 *
 * Deferring to first use — a trade, a cache read, a worker tick — puts creation
 * safely after the SDK has started.
 */
export const meters: Instruments = new Proxy({} as Instruments, {
  get: (_target, key) => (instruments ??= buildInstruments())[key as keyof Instruments],
});

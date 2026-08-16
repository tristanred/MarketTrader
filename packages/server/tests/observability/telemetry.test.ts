import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { metrics as metricsApi } from '@opentelemetry/api';
import { metrics as metricsSdk } from '@opentelemetry/sdk-node';

// Types come off the sdk-node namespace re-export rather than a direct
// `@opentelemetry/sdk-metrics` import — that package is a transitive dependency
// and is not resolvable from this workspace package under pnpm.
type ResourceMetrics = metricsSdk.ResourceMetrics;
type NumberDataPoint = metricsSdk.DataPoint<number>;

/**
 * Reads every data point recorded for `name`, flattening across resource and
 * scope so tests can assert on attributes without walking the OTLP shape.
 */
function pointsFor(collected: ResourceMetrics[], name: string): NumberDataPoint[] {
  return collected.flatMap((rm) =>
    rm.scopeMetrics.flatMap((sm) =>
      sm.metrics
        .filter((m) => m.descriptor.name === name)
        .flatMap((m) => m.dataPoints as NumberDataPoint[]),
    ),
  );
}

describe('telemetry instruments', () => {
  let exporter: metricsSdk.InMemoryMetricExporter;
  let provider: metricsSdk.MeterProvider;
  let reader: metricsSdk.PeriodicExportingMetricReader;

  // Import order here is the whole point of the test — see below.
  let meters: typeof import('../../src/observability/telemetry.js')['meters'];

  beforeAll(async () => {
    // 1. Load the telemetry module FIRST, with no meter provider registered.
    //    This reproduces production: `app.ts` pulls this module in long before
    //    `initTelemetry()` runs.
    ({ meters } = await import('../../src/observability/telemetry.js'));

    // 2. Only now register a real provider, exactly as initTelemetry() would.
    exporter = new metricsSdk.InMemoryMetricExporter(metricsSdk.AggregationTemporality.CUMULATIVE);
    reader = new metricsSdk.PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    provider = new metricsSdk.MeterProvider({ readers: [reader] });
    metricsApi.setGlobalMeterProvider(provider);
  });

  afterAll(async () => {
    await provider.shutdown();
    metricsApi.disable();
  });

  /**
   * Guards the failure that shipped once already: instruments built at module
   * load bind to the API's no-op meter permanently, because the metrics API —
   * unlike the trace API — has no proxy provider that back-fills. Every metric
   * then silently reads zero forever. If {@link meters} ever goes back to eager
   * construction, this test fails.
   */
  it('records through instruments created after the provider was registered', async () => {
    meters.tradesExecuted.add(1, { side: 'buy', mode: 'immediate' });
    meters.tradesExecuted.add(2, { side: 'sell', mode: 'resting' });

    await provider.forceFlush();

    const points = pointsFor(exporter.getMetrics(), 'markettrader.trades.executed');
    expect(points.length).toBeGreaterThan(0);

    const buys = points.find((p) => p.attributes.side === 'buy' && p.attributes.mode === 'immediate');
    const sells = points.find((p) => p.attributes.side === 'sell' && p.attributes.mode === 'resting');
    expect(buys?.value).toBe(1);
    expect(sells?.value).toBe(2);
  });

  it('tracks the WebSocket client gauge up and down', async () => {
    meters.wsClients.add(1, { scope: 'game' });
    meters.wsClients.add(1, { scope: 'game' });
    meters.wsClients.add(-1, { scope: 'game' });

    await provider.forceFlush();

    const points = pointsFor(exporter.getMetrics(), 'markettrader.ws.clients');
    const game = points.filter((p) => p.attributes.scope === 'game').at(-1);
    expect(game?.value).toBe(1);
  });

  it('separates quote-cache outcomes so a rate-limit outage is visible', async () => {
    meters.quoteCacheLookups.add(3, { result: 'hit' });
    meters.quoteCacheLookups.add(1, { result: 'miss' });
    meters.quoteCacheLookups.add(2, { result: 'stale' });

    await provider.forceFlush();

    const points = pointsFor(exporter.getMetrics(), 'markettrader.quote_cache.lookups');
    const byResult = Object.fromEntries(points.map((p) => [p.attributes.result, p.value]));
    expect(byResult).toMatchObject({ hit: 3, miss: 1, stale: 2 });
  });
});

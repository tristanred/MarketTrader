import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Telemetry is opt-in: production runs with `OTEL_EXPORTER_OTLP_ENDPOINT`
 * unset until a collector exists. That path has to be genuinely inert, not
 * merely quiet — a server that tries to reach a nonexistent collector on every
 * span would be worse than no telemetry at all.
 */
describe('initTelemetry when no endpoint is configured', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('constructs no exporters and starts no SDK', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');

    const traceExporter = vi.fn();
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: traceExporter,
    }));
    const sdkStart = vi.fn();
    vi.doMock('@opentelemetry/sdk-node', async () => {
      const actual = await vi.importActual<typeof import('@opentelemetry/sdk-node')>(
        '@opentelemetry/sdk-node',
      );
      return { ...actual, NodeSDK: vi.fn(() => ({ start: sdkStart, shutdown: vi.fn() })) };
    });

    const { initTelemetry } = await import('../../src/observability/otel.js');
    initTelemetry();

    expect(traceExporter).not.toHaveBeenCalled();
    expect(sdkStart).not.toHaveBeenCalled();
  });

  it('shutdownTelemetry resolves without error when nothing started', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');

    const { initTelemetry, shutdownTelemetry } = await import('../../src/observability/otel.js');
    initTelemetry();

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});

describe('resourceAttributes', () => {
  it('carries the build stamp so a metric can be traced back to a deploy', async () => {
    const { resourceAttributes } = await import('../../src/observability/otel.js');
    const { buildInfo } = await import('../../src/build-info.js');

    expect(resourceAttributes).toMatchObject({
      'service.name': 'markettrader-server',
      'service.version': buildInfo.version,
      'git.commit': buildInfo.commit,
    });
  });
});

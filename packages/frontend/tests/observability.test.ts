import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * Browser telemetry is opt-in at build time. A bundle built without
 * `VITE_OTEL_EXPORTER_URL` — which is the default, including every production
 * build until a collector exists — must not attach listeners, start exporters,
 * or reach the network. Getting this wrong means every user's browser retries
 * POSTs to a path that 404s.
 */
describe('initBrowserTelemetry when no exporter URL is configured', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_OTEL_EXPORTER_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('registers no global error listeners and makes no requests', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));

    const { initBrowserTelemetry } = await import('../src/observability/otel');
    initBrowserTelemetry();

    const listened = addEventListener.mock.calls.map(([type]) => type);
    expect(listened).not.toContain('error');
    expect(listened).not.toContain('unhandledrejection');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is safe to call twice', async () => {
    const { initBrowserTelemetry } = await import('../src/observability/otel');
    expect(() => {
      initBrowserTelemetry();
      initBrowserTelemetry();
    }).not.toThrow();
  });
});

describe('initBrowserTelemetry when configured', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_OTEL_EXPORTER_URL', '/otel');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /**
   * StrictMode double-invokes effects in development, and the module is also
   * imported dynamically — a second init would register a second set of error
   * listeners and double-report every uncaught exception.
   */
  it('attaches error listeners exactly once across repeat calls', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');

    const { initBrowserTelemetry } = await import('../src/observability/otel');
    initBrowserTelemetry();
    initBrowserTelemetry();

    const errorListeners = addEventListener.mock.calls.filter(([type]) => type === 'error');
    const rejectionListeners = addEventListener.mock.calls.filter(
      ([type]) => type === 'unhandledrejection',
    );
    expect(errorListeners).toHaveLength(1);
    expect(rejectionListeners).toHaveLength(1);
  });
});

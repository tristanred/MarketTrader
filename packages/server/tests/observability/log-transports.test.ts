import { describe, it, expect } from 'vitest';
import { logExportTargets, type LogExportConfig } from '../../src/observability/log-transports.js';

const base: LogExportConfig = {
  collector: null,
  posthog: null,
  loggerName: 'markettrader-server',
  serviceVersion: '1.2.3',
  resourceAttributes: { 'service.name': 'markettrader-server' },
};

describe('logExportTargets', () => {
  it('exports nothing when neither destination is configured', () => {
    expect(logExportTargets(base)).toEqual([]);
  });

  it('leaves the collector target on the exporter env defaults', () => {
    const [target] = logExportTargets({ ...base, collector: { level: 'info' } });
    expect(target).toMatchObject({ target: 'pino-opentelemetry-transport', level: 'info' });
    expect(target?.options).not.toHaveProperty('logRecordProcessorOptions');
    expect(target?.options).toMatchObject({ resourceAttributes: base.resourceAttributes });
  });

  it('points the PostHog target at /i/v1/logs with the project token', () => {
    const [target] = logExportTargets({
      ...base,
      posthog: { host: 'https://us.i.posthog.com/', key: 'phc_abc', level: 'warn' },
    });
    expect(target?.level).toBe('warn');
    expect(target?.options).toMatchObject({
      logRecordProcessorOptions: {
        exporterOptions: {
          protocol: 'http',
          httpExporterOptions: {
            url: 'https://us.i.posthog.com/i/v1/logs',
            headers: { Authorization: 'Bearer phc_abc' },
          },
        },
      },
    });
  });

  it('keeps both destinations independent, each with its own level', () => {
    const targets = logExportTargets({
      ...base,
      collector: { level: 'debug' },
      posthog: { host: 'https://us.i.posthog.com', key: 'phc_abc', level: 'error' },
    });
    expect(targets.map((t) => t.level)).toEqual(['debug', 'error']);
  });
});

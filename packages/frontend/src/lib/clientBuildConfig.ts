/** One Vite build-time variable baked into this bundle. */
export interface ClientBuildEntry {
  key: string;
  value: string | null;
  description: string;
}

/**
 * The build-time values this bundle was built with. Read-only by nature: Vite
 * inlines them at build time, so changing one means rebuilding the frontend.
 * All of them ship to every browser, so none is secret.
 */
export function clientBuildConfig(): ClientBuildEntry[] {
  const env = import.meta.env;
  return [
    { key: 'MODE', value: env.MODE, description: 'Vite build mode.' },
    {
      key: 'VITE_OTEL_EXPORTER_URL',
      value: env.VITE_OTEL_EXPORTER_URL ?? null,
      description: 'Where the browser sends OTLP telemetry. Empty disables it.',
    },
    {
      key: 'VITE_POSTHOG_KEY',
      value: env.VITE_POSTHOG_KEY ?? null,
      description: 'PostHog project token for the SPA. Public by design.',
    },
    {
      key: 'VITE_POSTHOG_HOST',
      value: env.VITE_POSTHOG_HOST ?? null,
      description: 'PostHog ingestion path — normally the same-origin /relay proxy.',
    },
    {
      key: 'VITE_POSTHOG_UI_HOST',
      value: env.VITE_POSTHOG_UI_HOST ?? null,
      description: 'PostHog app URL used for links out of the SPA.',
    },
  ];
}

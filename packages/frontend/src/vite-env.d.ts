/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base path the browser posts OTLP telemetry to, e.g. `/otel`. Unset (the
   * default) ships a build with browser telemetry disabled entirely.
   */
  readonly VITE_OTEL_EXPORTER_URL?: string;
  /** PostHog project token (`phc_…`). Unset ships a build with PostHog disabled. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion base — normally the same-origin `/relay` proxy. */
  readonly VITE_POSTHOG_HOST?: string;
  /** PostHog app origin for toolbar links. Defaults to `https://us.posthog.com`. */
  readonly VITE_POSTHOG_UI_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

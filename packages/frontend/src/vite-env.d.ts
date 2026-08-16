/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base path the browser posts OTLP telemetry to, e.g. `/otel`. Unset (the
   * default) ships a build with browser telemetry disabled entirely.
   */
  readonly VITE_OTEL_EXPORTER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

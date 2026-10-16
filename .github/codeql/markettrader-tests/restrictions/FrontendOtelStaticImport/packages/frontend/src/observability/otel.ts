export interface TelemetryHandle {
  shutdown(): Promise<void>;
}

export function initBrowserTelemetry(): TelemetryHandle {
  return { shutdown: async () => {} };
}

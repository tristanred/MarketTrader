declare const sdk: { capture(e: string): void; captureException(e: unknown): void };

// OK: the frontend facade is a different SDK and out of scope for the server rule.
export function capture(event: string) {
  sdk.capture(event);
  sdk.captureException(new Error(event));
}

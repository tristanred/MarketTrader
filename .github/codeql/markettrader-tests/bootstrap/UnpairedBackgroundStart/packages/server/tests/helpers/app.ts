declare function startPricePoller(): { stop(): Promise<void> };

// Out of scope (not server src): never flagged.
export async function buildApp() {
  startPricePoller();
  setInterval(() => {}, 10);
}

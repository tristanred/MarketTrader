/**
 * Client-side high-water mark of the latest unlock the player has seen as a
 * toast. Belt-and-braces against re-toasting on WS reconnect / page refresh /
 * React StrictMode double-mount. Keyed by (gameId, gamePlayerId) so multiple
 * games on the same browser don't bleed into each other.
 *
 * See docs/superpowers/specs/2026-05-23-achievements-frontend-design.md
 * → "Showing each unlock exactly once" → Layer 2.
 */

function key(gameId: string, gamePlayerId: string): string {
  return `last_seen_unlock_at:${gameId}:${gamePlayerId}`;
}

export function getSeenMarker(gameId: string, gamePlayerId: string): string | null {
  try {
    return localStorage.getItem(key(gameId, gamePlayerId));
  } catch {
    return null;
  }
}

/**
 * Atomically advances the marker to `unlockedAt` iff it's strictly newer than
 * the current value. Never regresses.
 */
export function advanceSeenMarker(gameId: string, gamePlayerId: string, unlockedAt: string): void {
  try {
    const current = localStorage.getItem(key(gameId, gamePlayerId));
    if (current === null || current < unlockedAt) {
      localStorage.setItem(key(gameId, gamePlayerId), unlockedAt);
    }
  } catch {
    // ignore — non-fatal, server-side ack + replay still de-dups
  }
}

/** True when the incoming unlock has already been displayed. */
export function isAlreadySeen(gameId: string, gamePlayerId: string, unlockedAt: string): boolean {
  const marker = getSeenMarker(gameId, gamePlayerId);
  return marker !== null && unlockedAt <= marker;
}

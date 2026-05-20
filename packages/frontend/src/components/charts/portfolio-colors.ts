/**
 * Palette slots for non-current-user players. Resolved against CSS variables
 * defined in `index.css` so light/dark theme adjustments live in one place.
 * The current user is always rendered with `--accent` — see {@link colorForPlayer}.
 */
export const PLAYER_PALETTE = [
  'var(--p2)',
  'var(--p3)',
  'var(--p4)',
  'var(--p5)',
  'var(--p6)',
  'var(--p7)',
  'var(--p8)',
] as const;

/**
 * Deterministic colour for a player ID. The current user always gets
 * `var(--accent)` so "your line" is the same cyan everywhere in the app,
 * regardless of which other players are in the game. Other players are
 * hashed (FNV-1a) into the 7-slot palette — same playerId, same colour
 * across panels, refreshes, and sessions.
 */
export function colorForPlayer(playerId: string, isCurrentUser: boolean): string {
  if (isCurrentUser) return 'var(--accent)';
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash ^ playerId.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const idx = hash % PLAYER_PALETTE.length;
  // Safe: idx is constrained to [0, PLAYER_PALETTE.length-1] above.
  return PLAYER_PALETTE[idx]!;
}

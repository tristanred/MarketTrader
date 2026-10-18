/** `s` cut to at most `max` characters, ending in an ellipsis when it was cut. */
export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

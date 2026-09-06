/** Pixel dimensions of the symbol-note popover. */
export interface NoteSize {
  width: number;
  height: number;
}

const STORAGE_KEY = 'mt:note-size';

/** Opening size before the user has ever resized — deliberately small. */
export const DEFAULT_NOTE_SIZE: NoteSize = { width: 260, height: 148 };

/** Floor for a drag-resize; below this the textarea stops being usable. */
export const MIN_NOTE_SIZE: NoteSize = { width: 208, height: 116 };

/**
 * Gap kept between the note and the viewport edge. Matches the `collisionPadding`
 * the popover is rendered with, so a drag that stops at this margin never asks
 * Radix for a position it would then slide back.
 */
export const VIEWPORT_MARGIN = 12;

/**
 * Fits `size` inside the current viewport without letting it collapse past
 * {@link MIN_NOTE_SIZE}. A size stored on a wide monitor would otherwise open
 * off-screen on a phone, so every read and every resize goes through this.
 * The minimum wins over the viewport: a popover that overflows a tiny screen
 * still beats one squeezed to nothing.
 */
export function clampNoteSize(size: NoteSize): NoteSize {
  const maxWidth = Math.max(MIN_NOTE_SIZE.width, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(MIN_NOTE_SIZE.height, window.innerHeight - VIEWPORT_MARGIN * 2);
  return {
    width: Math.round(Math.min(Math.max(size.width, MIN_NOTE_SIZE.width), maxWidth)),
    height: Math.round(Math.min(Math.max(size.height, MIN_NOTE_SIZE.height), maxHeight)),
  };
}

/**
 * The last size the user dragged the note popover to, clamped to this
 * viewport. Returns {@link DEFAULT_NOTE_SIZE} when nothing is stored or the
 * stored value is unreadable.
 */
export function readNoteSize(): NoteSize {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTE_SIZE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOTE_SIZE;
    const { width, height } = parsed as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number') return DEFAULT_NOTE_SIZE;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return DEFAULT_NOTE_SIZE;
    return clampNoteSize({ width, height });
  } catch {
    // Private-mode Safari throws on localStorage access rather than returning null.
    return DEFAULT_NOTE_SIZE;
  }
}

/** Persists the note popover size. Called once per resize gesture, on pointerup. */
export function writeNoteSize(size: NoteSize): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Quota or private mode — the size is a convenience, not worth surfacing.
  }
}

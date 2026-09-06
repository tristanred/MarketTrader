import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_NOTE_SIZE,
  MIN_NOTE_SIZE,
  clampNoteSize,
  readNoteSize,
  writeNoteSize,
} from '@/lib/noteSize';

function setViewport(width: number, height: number) {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
}

describe('noteSize', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewport(1440, 900);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the default size when nothing is stored', () => {
    expect(readNoteSize()).toEqual(DEFAULT_NOTE_SIZE);
  });

  it('round-trips a size through localStorage', () => {
    writeNoteSize({ width: 420, height: 300 });
    expect(readNoteSize()).toEqual({ width: 420, height: 300 });
  });

  it('clamps a stored size down to fit a smaller viewport', () => {
    setViewport(1440, 900);
    writeNoteSize({ width: 900, height: 700 });
    setViewport(390, 700);
    const restored = readNoteSize();
    expect(restored.width).toBeLessThanOrEqual(390);
    expect(restored.height).toBeLessThanOrEqual(700);
  });

  it('never clamps below the minimum, even on a tiny viewport', () => {
    setViewport(200, 180);
    expect(clampNoteSize({ width: 10, height: 10 })).toEqual(MIN_NOTE_SIZE);
  });

  it('ignores a corrupt stored value rather than throwing', () => {
    window.localStorage.setItem('mt:note-size', 'not json');
    expect(readNoteSize()).toEqual(DEFAULT_NOTE_SIZE);
  });

  it('ignores a stored value with non-numeric dimensions', () => {
    window.localStorage.setItem('mt:note-size', JSON.stringify({ width: 'wide', height: null }));
    expect(readNoteSize()).toEqual(DEFAULT_NOTE_SIZE);
  });
});

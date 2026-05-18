import { describe, expect, it, beforeEach } from 'vitest';
import { useCommandKStore } from '@/stores/commandKStore';

describe('useCommandKStore', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  it('starts closed', () => {
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('open$() sets open=true', () => {
    useCommandKStore.getState().open$();
    expect(useCommandKStore.getState().open).toBe(true);
  });

  it('close() sets open=false', () => {
    useCommandKStore.getState().open$();
    useCommandKStore.getState().close();
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('toggle() flips the state', () => {
    useCommandKStore.getState().toggle();
    expect(useCommandKStore.getState().open).toBe(true);
    useCommandKStore.getState().toggle();
    expect(useCommandKStore.getState().open).toBe(false);
  });
});

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandK } from '@/hooks/useCommandK';
import { useCommandKStore } from '@/stores/commandKStore';

describe('useCommandK', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  function fireKey(key: string, metaKey = false, ctrlKey = false) {
    const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it('toggles the overlay on cmd+k (metaKey)', () => {
    renderHook(() => useCommandK());
    fireKey('k', true, false);
    expect(useCommandKStore.getState().open).toBe(true);
    fireKey('k', true, false);
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('toggles the overlay on ctrl+k', () => {
    renderHook(() => useCommandK());
    fireKey('k', false, true);
    expect(useCommandKStore.getState().open).toBe(true);
  });

  it('ignores plain "k" without a modifier', () => {
    renderHook(() => useCommandK());
    fireKey('k', false, false);
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('closes the overlay on Escape when it is open', () => {
    renderHook(() => useCommandK());
    useCommandKStore.getState().open$();
    fireKey('Escape');
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useCommandK());
    unmount();
    fireKey('k', true, false);
    expect(useCommandKStore.getState().open).toBe(false);
  });
});

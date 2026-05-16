import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('themeStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    // Reset module registry so `readInitial` re-runs on each import.
    vi.resetModules();
  });

  it('defaults to dark when no stored preference exists', async () => {
    const mod = await import('@/stores/themeStore');
    expect(mod.useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('honors a stored light preference', async () => {
    window.localStorage.setItem('mt:theme', 'light');
    const mod = await import('@/stores/themeStore');
    expect(mod.useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggle flips dark <-> light and persists', async () => {
    const mod = await import('@/stores/themeStore');
    mod.useThemeStore.getState().toggle();
    expect(mod.useThemeStore.getState().theme).toBe('light');
    expect(window.localStorage.getItem('mt:theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    mod.useThemeStore.getState().toggle();
    expect(mod.useThemeStore.getState().theme).toBe('dark');
    expect(window.localStorage.getItem('mt:theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

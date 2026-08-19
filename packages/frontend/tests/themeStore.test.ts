import { beforeEach, describe, expect, it, vi } from 'vitest';

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

describe('themeStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
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

  // iOS tints the status bar of an installed home-screen app from this meta
  // tag; it is the only signal that follows the in-app toggle rather than the
  // OS preference, so it has to be rewritten on every theme change.
  it('rewrites the theme-color meta to match the active theme', async () => {
    const mod = await import('@/stores/themeStore');
    expect(themeColor()).toBe('#0a0b0d');
    mod.useThemeStore.getState().setTheme('light');
    expect(themeColor()).toBe('#f7f5f0');
    mod.useThemeStore.getState().setTheme('dark');
    expect(themeColor()).toBe('#0a0b0d');
  });
});

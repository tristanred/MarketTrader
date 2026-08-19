import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem('mt:theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

// Must track --bg in index.css. iOS tints the status bar of an installed
// home-screen app from this value, so a stale one shows as a mismatched band
// above the header.
const THEME_COLOR: Record<Theme, string> = {
  dark: '#0a0b0d',
  light: '#f7f5f0',
};

function applyHtmlClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // The theme is a class the user toggles, independent of the OS preference,
  // so a `media="(prefers-color-scheme: …)"` pair of meta tags cannot express
  // it — the one tag has to be rewritten here.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readInitial();
  applyHtmlClass(initial);
  return {
    theme: initial,
    setTheme: (t) => {
      window.localStorage.setItem('mt:theme', t);
      applyHtmlClass(t);
      set({ theme: t });
    },
    toggle: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },
  };
});

/** Shorthand hook returning `{ theme, toggle }` for components that only need that pair. */
export function useTheme() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  return { theme, toggle };
}

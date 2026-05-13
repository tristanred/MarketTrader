import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('mt:theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyHtmlClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
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

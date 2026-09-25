import { create } from 'zustand';

export type ChartType = 'line' | 'area' | 'candles';

interface ChartPrefs {
  type: ChartType;
  showVolume: boolean;
  showTrades: boolean;
}

interface ChartPrefsState extends ChartPrefs {
  setType: (t: ChartType) => void;
  toggleVolume: () => void;
  toggleTrades: () => void;
}

const STORAGE_KEY = 'mt:chart';
const DEFAULTS: ChartPrefs = { type: 'candles', showVolume: true, showTrades: true };

function readInitial(): ChartPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS;
    const p = parsed as Partial<Record<keyof ChartPrefs, unknown>>;
    return {
      type: p.type === 'line' || p.type === 'area' || p.type === 'candles' ? p.type : DEFAULTS.type,
      showVolume: typeof p.showVolume === 'boolean' ? p.showVolume : DEFAULTS.showVolume,
      showTrades: typeof p.showTrades === 'boolean' ? p.showTrades : DEFAULTS.showTrades,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(prefs: ChartPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: the preference just won't survive a reload.
  }
}

/** Per-browser chart display preferences (series type, volume and trade overlays). */
export const useChartPrefsStore = create<ChartPrefsState>((set, get) => {
  const update = (patch: Partial<ChartPrefs>) => {
    const { type, showVolume, showTrades } = { ...get(), ...patch };
    persist({ type, showVolume, showTrades });
    set(patch);
  };
  return {
    ...readInitial(),
    setType: (type) => update({ type }),
    toggleVolume: () => update({ showVolume: !get().showVolume }),
    toggleTrades: () => update({ showTrades: !get().showTrades }),
  };
});

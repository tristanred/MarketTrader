import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        hairline: {
          DEFAULT: 'var(--hairline)',
          strong: 'var(--hairline-strong)',
        },
        text: {
          DEFAULT: 'var(--text)',
          strong: 'var(--text-strong)',
        },
        muted: 'var(--muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          bg: 'var(--accent-bg)',
        },
        gain: 'var(--gain)',
        loss: 'var(--loss)',
        disabled: {
          fg: 'var(--disabled-fg)',
          bg: 'var(--disabled-bg)',
          border: 'var(--disabled-border)',
        },

        // ─── Compatibility aliases ──────────────────────────────
        // Existing ShadCN UI primitives reference these names. Map
        // them to the new tokens so we don't have to rewrite every
        // component in this phase. Later phases remove unused ones.
        background: 'var(--bg)',
        foreground: 'var(--text)',
        border: 'var(--hairline-strong)',
        input: 'var(--hairline-strong)',
        ring: 'var(--accent)',
        card: {
          DEFAULT: 'var(--panel)',
          foreground: 'var(--text)',
        },
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--bg)',
        },
        destructive: {
          DEFAULT: 'var(--loss)',
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: 'var(--gain)',
          foreground: '#ffffff',
        },
        'muted-foreground': 'var(--muted)',
        'accent-foreground': 'var(--text-strong)',
      },
      fontFamily: {
        sans: ['Geist Sans', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        panel: '6px',
        chip: '4px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;

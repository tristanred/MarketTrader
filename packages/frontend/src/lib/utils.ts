import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names and resolve Tailwind conflicts (e.g. `p-2 p-4` → `p-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a number as USD currency. */
export function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format a percentage with one decimal place and a sign. */
export function formatPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Format a large integer in compact notation (e.g. 7_950_000 → "7.95M"). */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Validates a ticker symbol the way the trade and quote-info UIs expect:
 * 1–10 chars, uppercase letters/digits with optional `.` or `-` (e.g. `BRK.B`).
 */
export const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

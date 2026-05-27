import { cn } from '@/lib/utils';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Inline SVG of the MarketTrader candlestick monogram. Used in the app
 * topbar and anywhere a small brand glyph is needed. Colors are
 * hard-coded so the mark renders correctly outside CSS-variable contexts;
 * keep them in sync with `tools/logo-assets/mark.svg`.
 */
export function BrandMark({ size = 20, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="MarketTrader"
      className={cn(className)}
    >
      <rect x="1" y="1" width="62" height="62" rx="3" fill="#0c0d10" stroke="#1d1f23" strokeWidth="1" />
      <g stroke="#161719" strokeWidth="1">
        <line x1="0" y1="22" x2="64" y2="22" />
        <line x1="0" y1="42" x2="64" y2="42" />
      </g>
      <line x1="21" y1="10" x2="21" y2="54" stroke="#10b981" strokeWidth="2" />
      <rect x="16" y="18" width="10" height="28" fill="#10b981" />
      <line x1="43" y1="14" x2="43" y2="56" stroke="#ef4444" strokeWidth="2" />
      <rect x="38" y="22" width="10" height="24" fill="#ef4444" />
      <line x1="21" y1="32" x2="43" y2="32" stroke="#67e8f9" strokeWidth="2" />
      <circle cx="32" cy="32" r="2.4" fill="#67e8f9" />
    </svg>
  );
}

import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { StockChart } from '@/components/StockChart';

export interface ChartPanelProps {
  symbol: string | null;
  className?: string;
}

/**
 * Center-column chart wrapper. Phase 3b ships the chrome only — the
 * underlying StockChart keeps its current visual style. Phase 3c can
 * revisit chart colors if needed.
 */
export function ChartPanel({ symbol, className }: ChartPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Chart{symbol ? ` · ${symbol}` : ''}</PanelHeader>
      <PanelBody>
        {symbol ? (
          <StockChart symbols={[symbol]} />
        ) : (
          <p className="py-6 text-center text-xs text-muted">Select a symbol to see its chart.</p>
        )}
      </PanelBody>
    </Panel>
  );
}

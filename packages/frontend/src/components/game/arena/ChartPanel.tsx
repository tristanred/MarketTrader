import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { StockChart } from '@/components/StockChart';

export interface ChartPanelProps {
  symbol: string | null;
  /** Enables the viewer's trade markers and avg-cost line. */
  gameId?: string;
  className?: string;
}

/** Center-column chart wrapper around {@link StockChart} for the selected symbol. */
export function ChartPanel({ symbol, gameId, className }: ChartPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Chart{symbol ? ` · ${symbol}` : ''}</PanelHeader>
      <PanelBody>
        {symbol ? (
          <StockChart symbols={[symbol]} gameId={gameId} />
        ) : (
          <p className="py-6 text-center text-xs text-muted">Select a symbol to see its chart.</p>
        )}
      </PanelBody>
    </Panel>
  );
}

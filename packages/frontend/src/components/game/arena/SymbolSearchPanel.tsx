import { Panel, PanelBody } from '@/components/panel';
import { SymbolSearch } from '@/components/search';
import { useCommandKStore } from '@/stores/commandKStore';

export interface SymbolSearchPanelProps {
  onSelect: (symbol: string) => void;
  className?: string;
}

/**
 * Right-column pinned search input. The visible affordance — clicking or
 * focusing it opens the same global cmd+k overlay so non-power users have
 * a discoverable path to the typeahead. Direct `onSelect` calls from the
 * inline list still flow when the user just types into the panel.
 */
export function SymbolSearchPanel({ onSelect, className }: SymbolSearchPanelProps) {
  const openOverlay = useCommandKStore((s) => s.open$);

  return (
    <Panel className={className}>
      <PanelBody>
        <SymbolSearch
          placeholder="▸ Search symbol..."
          hintKbd
          onSelect={onSelect}
          onInputFocus={openOverlay}
          onInputClick={openOverlay}
        />
      </PanelBody>
    </Panel>
  );
}

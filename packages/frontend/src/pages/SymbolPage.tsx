import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { QuoteInfo } from '@/components/QuoteInfo';
import { TradeInGameButton } from '@/components/symbol/TradeInGameButton';
import { SYMBOL_RE } from '@/lib/utils';

/**
 * Standalone, deep-linkable quote-information page. Renders the same content
 * as the modal at a more generous width. Surfaces a {@link TradeInGameButton}
 * so the search → quote → trade chain closes from outside the arena: 0
 * active games hides the affordance entirely; 1 or N open a TradeOrderDialog
 * over the page.
 */
export function SymbolPage() {
  const { symbol: rawSymbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const symbol = (rawSymbol ?? '').toUpperCase();

  if (!SYMBOL_RE.test(symbol)) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-3 flex justify-end">
        <TradeInGameButton symbol={symbol} />
      </div>
      <QuoteInfo
        symbol={symbol}
        variant="full"
        onSymbolChange={(next) => navigate(`/symbols/${next}`)}
        showTradeButton={false}
      />
    </main>
  );
}

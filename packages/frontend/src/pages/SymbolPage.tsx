import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { QuoteInfo } from '@/components/QuoteInfo';
import { SYMBOL_RE } from '@/lib/utils';

/**
 * Standalone, deep-linkable quote-information page. Renders the same content
 * as the modal at a more generous width. Trading from outside a game is a
 * separate concern (the player needs a game context), so the trade button is
 * suppressed here for now — TODO: when the user belongs to ≥1 active game,
 * surface a "Trade in <game>" navigation.
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
      <QuoteInfo
        symbol={symbol}
        variant="full"
        onSymbolChange={(next) => navigate(`/symbols/${next}`)}
        showTradeButton={false}
      />
    </main>
  );
}

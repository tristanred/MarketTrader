import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStockSearch, useStockQuote } from '@/api/stocks';
import { usePlaceTrade } from '@/api/trades';
import { useLiveStore } from '@/stores/liveStore';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { formatUSD, cn } from '@/lib/utils';
import type { TradeDirection } from '@markettrader/shared';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

export function TradePanel({ gameId }: { gameId: string }) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [direction, setDirection] = useState<TradeDirection>('buy');
  const [quantity, setQuantity] = useState<number>(1);

  const search = useStockSearch(debounced);
  const quote = useStockQuote(symbol ?? '');
  const livePrice = useLiveStore((s) => (symbol ? s.pricesBySymbol[symbol]?.price : undefined));
  const place = usePlaceTrade(gameId);

  const displayPrice = livePrice ?? quote.data?.price;
  const total = displayPrice !== undefined ? displayPrice * quantity : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol) return;
    try {
      await place.mutateAsync({ symbol, direction, quantity });
      toast({
        title: `${direction === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${symbol}`,
        ...(total !== null ? { description: `~ ${formatUSD(total)}` } : {}),
        variant: 'success',
      });
    } catch (err) {
      const message =
        err instanceof ApiError && err.body && typeof err.body === 'object' && 'message' in err.body
          ? String((err.body as { message: unknown }).message)
          : 'Trade failed';
      toast({ title: 'Trade failed', description: message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="symbol-search">Symbol</Label>
            <Input
              id="symbol-search"
              placeholder="Search ticker (e.g. AAPL)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.toUpperCase());
                setSymbol(null);
              }}
              autoComplete="off"
            />
            {search.data && search.data.length > 0 && !symbol && (
              <ul className="max-h-44 overflow-auto rounded-md border bg-background mt-1">
                {search.data.slice(0, 8).map((r) => (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setSymbol(r.symbol);
                        setQuery(r.symbol);
                      }}
                    >
                      <span className="font-medium">{r.symbol}</span>
                      <span className="ml-2 text-muted-foreground">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {symbol && (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{symbol}</span>
                <span>{displayPrice !== undefined ? formatUSD(displayPrice) : '…'}</span>
              </div>
              {livePrice !== undefined && (
                <p className="mt-1 text-xs text-muted-foreground">live</p>
              )}
            </div>
          )}

          <Tabs value={direction} onValueChange={(v) => setDirection(v as TradeDirection)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="buy">Buy</TabsTrigger>
              <TabsTrigger value="sell">Sell</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-1">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>

          {total !== null && (
            <div className="text-sm text-muted-foreground">
              Estimated total: <span className="font-medium text-foreground">{formatUSD(total)}</span>
            </div>
          )}

          <Button
            type="submit"
            className={cn('w-full', direction === 'sell' && 'bg-destructive hover:bg-destructive/90')}
            disabled={!symbol || place.isPending || quantity < 1}
          >
            {place.isPending ? 'Placing…' : direction === 'buy' ? 'Buy' : 'Sell'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

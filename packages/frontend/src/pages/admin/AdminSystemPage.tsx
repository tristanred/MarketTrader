import { useState } from 'react';
import {
  useAdminStats,
  useAdminSetStockPrice,
  useAdminFlushPriceCache,
} from '@/api/admin/system';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { toastApiError } from '@/lib/toastApiError';
import { TickerTapeEditor } from '@/components/admin/TickerTapeEditor';

export function AdminSystemPage() {
  const stats = useAdminStats();
  const setPrice = useAdminSetStockPrice();
  const flush = useAdminFlushPriceCache();

  const [symbol, setSymbol] = useState('');
  const [price, setPrice_] = useState('');
  const [change, setChange] = useState('');
  const [changePercent, setChangePercent] = useState('');
  const [showFlush, setShowFlush] = useState(false);

  async function submitPrice() {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) {
      toast({ title: 'Price must be positive', variant: 'destructive' });
      return;
    }
    try {
      await setPrice.mutateAsync({
        symbol: symbol.toUpperCase(),
        body: {
          price: p,
          ...(change ? { change: Number(change) } : {}),
          ...(changePercent ? { changePercent: Number(changePercent) } : {}),
        },
      });
      toast({ title: 'Price override set', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Override failed');
    }
  }

  async function doFlush() {
    try {
      const res = await flush.mutateAsync();
      toast({
        title: `Flushed ${res.entriesRemoved} cache entries`,
        variant: 'success',
      });
      setShowFlush(false);
    } catch (err) {
      toastApiError(err, 'Flush failed');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">System</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stats</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.isLoading && <Skeleton className="h-24 w-full" />}
          {stats.data && (
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Stat label="WebSocket conns" value={stats.data.websocketConnections} />
              <Stat label="Uptime (s)" value={stats.data.uptimeSeconds} />
              {Object.entries(stats.data.rowCounts).map(([k, v]) => (
                <Stat key={k} label={k} value={v} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Override stock price</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="sym">Symbol</Label>
            <Input id="sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="price">Price</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice_(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="change">Change ($)</Label>
            <Input
              id="change"
              type="number"
              step="0.01"
              value={change}
              onChange={(e) => setChange(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="changePercent">Change %</Label>
            <Input
              id="changePercent"
              type="number"
              step="0.01"
              value={changePercent}
              onChange={(e) => setChangePercent(e.target.value)}
            />
          </div>
          <div className="sm:col-span-4">
            <Button onClick={submitPrice} disabled={!symbol || !price || setPrice.isPending}>
              {setPrice.isPending ? 'Saving…' : 'Override'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price cache</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setShowFlush(true)}>
            Flush price cache
          </Button>
        </CardContent>
      </Card>

      <TickerTapeEditor />

      <ConfirmDialog
        open={showFlush}
        onOpenChange={setShowFlush}
        title="Flush price cache?"
        description="Removes every cached price; next quote requests hit the upstream provider."
        confirmLabel="Flush"
        destructive
        onConfirm={doFlush}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAdminTickerTape, useAdminUpdateTickerTape } from '@/api/admin/system';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/lib/toastApiError';

const SYMBOL_RE = /^[A-Z^][A-Z0-9.\-^]{0,11}$/;

/**
 * Admin editor for the ticker-tape symbol list. Tracks an in-memory working
 * list; the persisted config is only updated on Save. Removing a symbol
 * doesn't fire until the user clicks Save, so accidental clicks are
 * recoverable by adding the chip back before submitting.
 */
export function TickerTapeEditor() {
  const tape = useAdminTickerTape();
  const update = useAdminUpdateTickerTape();
  const [working, setWorking] = useState<string[]>([]);
  const [pending, setPending] = useState('');

  // Seed the working list from server data once it loads. Also re-sync
  // after a successful save (the mutation's onSuccess writes new data
  // into the same query key).
  useEffect(() => {
    if (tape.data) setWorking(tape.data.symbols);
  }, [tape.data]);

  function addSymbol() {
    const next = pending.trim().toUpperCase();
    if (!next) return;
    if (!SYMBOL_RE.test(next)) {
      toast({ title: `Invalid symbol "${next}"`, variant: 'destructive' });
      return;
    }
    if (working.includes(next)) {
      toast({ title: `${next} is already on the tape`, variant: 'destructive' });
      return;
    }
    setWorking([...working, next]);
    setPending('');
  }

  function removeSymbol(sym: string) {
    setWorking(working.filter((s) => s !== sym));
  }

  async function save() {
    try {
      await update.mutateAsync({ symbols: working });
      toast({ title: 'Ticker tape updated', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Could not save ticker tape');
    }
  }

  if (tape.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticker tape</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Symbols that scroll across the bottom of every page. Index tickers like
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">^GSPC</code>
          are supported. Changes apply to all connected users immediately.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {working.map((s) => (
            <li
              key={s}
              className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 font-mono text-xs"
            >
              <span>{s}</span>
              <button
                type="button"
                onClick={() => removeSymbol(s)}
                aria-label={`Remove ${s}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="tape-add">Add symbol</Label>
            <Input
              id="tape-add"
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSymbol();
                }
              }}
              placeholder="e.g. AAPL or ^GSPC"
            />
          </div>
          <Button type="button" variant="outline" onClick={addSymbol}>
            Add
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={working.length === 0 || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

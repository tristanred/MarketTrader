import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TradeHistoryTable } from '@/components/TradeHistoryTable';
import { OpenOrdersList } from '@/components/OpenOrdersList';

/**
 * Bottom-of-page activity card. Replaces the legacy "Trade Desk" — trading
 * itself happens via {@link SymbolSearchCard} → {@link TradeOrderDialog}.
 */
export function TradeActivityCard({ gameId }: { gameId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="uppercase tracking-wide text-xs text-muted-foreground">
          Trade Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="open-orders">
          <TabsList>
            <TabsTrigger value="open-orders">Open Orders</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="open-orders" className="pt-3">
            <OpenOrdersList gameId={gameId} />
          </TabsContent>
          <TabsContent value="history" className="pt-3">
            <TradeHistoryTable gameId={gameId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

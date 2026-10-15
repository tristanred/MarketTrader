import YahooFinance from 'yahoo-finance2'; // BAD: route bypasses StockProvider
import Alpaca from '@alpacahq/alpaca-trade-api'; // BAD
import { restClient } from '@polygon.io/client-js'; // BAD
import type { StockProvider } from '../providers/interface'; // OK

export async function quote(p: StockProvider) {
  const legacy = await import('yahoo-finance2/dist/esm/src/index-common.js'); // BAD: subpath
  return [YahooFinance, Alpaca, restClient, legacy, p];
}

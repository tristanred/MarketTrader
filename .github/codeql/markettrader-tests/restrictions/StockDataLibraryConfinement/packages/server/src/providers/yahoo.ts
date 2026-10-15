// OK: providers/ owns market-data SDKs.
import YahooFinance from 'yahoo-finance2';
import Alpaca from '@alpacahq/alpaca-trade-api';

export const sdks = [YahooFinance, Alpaca];

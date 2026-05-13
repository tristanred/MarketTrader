import type { MarketStatusResult } from '@markettrader/shared';
import { StockProviderError } from '../interface.js';
import type { MarketStatusProvider } from './interface.js';

interface ClockResponse {
  timestamp?: string;
  is_open?: boolean;
  next_open?: string;
  next_close?: string;
}

/**
 * {@link MarketStatusProvider} backed by Alpaca's `GET /v2/clock` endpoint.
 * Authoritative for US equities. Alpaca doesn't distinguish PRE/POST, so
 * `is_open === false` is mapped to `CLOSED`; the chart only cares about
 * `REGULAR` anyway.
 */
export class AlpacaMarketStatus implements MarketStatusProvider {
  private readonly url = 'https://api.alpaca.markets/v2/clock';

  constructor(private readonly apiKey: string) {}

  async getStatus(): Promise<MarketStatusResult> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        headers: {
          'APCA-API-KEY-ID': this.apiKey,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new StockProviderError('PROVIDER_ERROR', `Alpaca clock fetch failed: ${(err as Error).message}`);
    }

    if (res.status === 429) {
      throw new StockProviderError('RATE_LIMITED', 'Alpaca clock rate-limited');
    }
    if (!res.ok) {
      throw new StockProviderError('PROVIDER_ERROR', `Alpaca clock returned ${res.status}`);
    }

    const data = (await res.json()) as ClockResponse;
    const isOpen = data.is_open === true;
    const nextChangeAt = isOpen ? data.next_close : data.next_open;
    return {
      state: isOpen ? 'REGULAR' : 'CLOSED',
      asOf: data.timestamp ?? new Date().toISOString(),
      ...(nextChangeAt && { nextChangeAt }),
      source: 'alpaca',
    };
  }
}

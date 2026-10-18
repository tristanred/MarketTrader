import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YahooProvider } from '../../src/providers/yahoo.js';
import { StockProviderError } from '../../src/providers/index.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('YahooProvider rate-limit handling', () => {
  let provider: YahooProvider;

  beforeEach(() => {
    provider = new YahooProvider(RuntimeConfig.fromEnvironment());
  });

  /**
   * Replace the internal yahoo-finance2 client with stubs we control. The
   * private `client` field is accessed via `as any` only for the test.
   */
  function stubClient(provider: YahooProvider, stubs: { quote?: unknown; search?: unknown }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = stubs;
  }

  it('maps "Too Many Requests" errors from quote() to StockProviderError(RATE_LIMITED)', async () => {
    stubClient(provider, {
      quote: vi.fn().mockRejectedValue(new Error('Too Many Requests')),
    });
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({
      name: 'StockProviderError',
      code: 'RATE_LIMITED',
    });
  });

  it('after a 429, subsequent calls inside the backoff fail fast without invoking the client', async () => {
    const mockQuote = vi.fn().mockRejectedValue(new Error('Too Many Requests'));
    stubClient(provider, { quote: mockQuote });

    await expect(provider.getQuote('AAPL')).rejects.toBeInstanceOf(StockProviderError);
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(mockQuote).toHaveBeenCalledTimes(1); // second call short-circuited
  });

  it('maps 429 from search() to RATE_LIMITED (no longer swallows as empty array)', async () => {
    stubClient(provider, {
      search: vi.fn().mockRejectedValue(new Error('Too Many Requests')),
    });
    await expect(provider.searchSymbols('AAPL')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('non-429 errors propagate as PROVIDER_ERROR', async () => {
    stubClient(provider, {
      quote: vi.fn().mockRejectedValue(new Error('Some other failure')),
    });
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('returns a normalized StockQuote on success', async () => {
    stubClient(provider, {
      quote: vi.fn().mockResolvedValue({
        symbol: 'AAPL',
        regularMarketPrice: 175.5,
        regularMarketChange: 1.2,
        regularMarketChangePercent: 0.69,
      }),
    });
    const quote = await provider.getQuote('AAPL');
    expect(quote.symbol).toBe('AAPL');
    expect(quote.price).toBe(175.5);
    expect(quote.change).toBe(1.2);
    expect(quote.changePercent).toBe(0.69);
  });

  it('maps regularMarketOpen/DayHigh/DayLow to open/high/low', async () => {
    stubClient(provider, {
      quote: vi.fn().mockResolvedValue({
        symbol: 'AAPL',
        regularMarketPrice: 175.5,
        regularMarketChange: 1.2,
        regularMarketChangePercent: 0.69,
        regularMarketOpen: 174.0,
        regularMarketDayHigh: 176.8,
        regularMarketDayLow: 173.2,
        regularMarketVolume: 42_000_000,
      }),
    });
    const quote = await provider.getQuote('AAPL');
    expect(quote.open).toBe(174.0);
    expect(quote.high).toBe(176.8);
    expect(quote.low).toBe(173.2);
    expect(quote.volume).toBe(42_000_000);
  });

  it('omits open/high/low when the upstream does not report them', async () => {
    stubClient(provider, {
      quote: vi.fn().mockResolvedValue({ symbol: 'AAPL', regularMarketPrice: 175.5 }),
    });
    const quote = await provider.getQuote('AAPL');
    expect(quote.open).toBeUndefined();
    expect(quote.high).toBeUndefined();
    expect(quote.low).toBeUndefined();
  });

  it('throws SYMBOL_NOT_FOUND when the upstream response lacks a price', async () => {
    stubClient(provider, { quote: vi.fn().mockResolvedValue(null) });
    await expect(provider.getQuote('NOPE')).rejects.toMatchObject({
      code: 'SYMBOL_NOT_FOUND',
    });
  });

  it('recovers search results from FailedYahooValidationError (benign schema drift)', async () => {
    const validationErr = Object.assign(new Error('Failed Yahoo Schema validation'), {
      name: 'FailedYahooValidationError',
      result: {
        quotes: [
          { isYahooFinance: true, quoteType: 'EQUITY', symbol: 'AAPL', shortname: 'Apple Inc.' },
          { isYahooFinance: true, quoteType: 'ETF', symbol: 'SPY', shortname: 'SPDR S&P 500' },
        ],
      },
    });
    stubClient(provider, { search: vi.fn().mockRejectedValue(validationErr) });

    const results = await provider.searchSymbols('AAPL');
    expect(results).toEqual([{ symbol: 'AAPL', name: 'Apple Inc.' }]);
  });

  it('maps a validation error without a recoverable result to PROVIDER_ERROR', async () => {
    const validationErr = Object.assign(new Error('Failed Yahoo Schema validation'), {
      name: 'FailedYahooValidationError',
      result: null,
    });
    stubClient(provider, { search: vi.fn().mockRejectedValue(validationErr) });

    await expect(provider.searchSymbols('AAPL')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  describe('getQuotes (batch)', () => {
    it('returns a Map of normalized quotes keyed by symbol', async () => {
      const quote = vi.fn().mockResolvedValue(
        new Map([
          ['AAPL', { symbol: 'AAPL', regularMarketPrice: 175.5, regularMarketChange: 1.2, regularMarketChangePercent: 0.69 }],
          ['MSFT', { symbol: 'MSFT', regularMarketPrice: 410, regularMarketChange: -2, regularMarketChangePercent: -0.49 }],
        ]),
      );
      stubClient(provider, { quote });

      const result = await provider.getQuotes(['AAPL', 'MSFT']);
      expect(quote).toHaveBeenCalledTimes(1); // one batch call
      expect(result.get('AAPL')?.changePercent).toBe(0.69);
      expect(result.get('AAPL')?.price).toBe(175.5);
      expect(result.get('MSFT')?.changePercent).toBe(-0.49);
    });

    it('maps open/high/low from the batch rows', async () => {
      const quote = vi.fn().mockResolvedValue(
        new Map([
          [
            'AAPL',
            {
              symbol: 'AAPL',
              regularMarketPrice: 175.5,
              regularMarketChangePercent: 0.69,
              regularMarketOpen: 174,
              regularMarketDayHigh: 176.8,
              regularMarketDayLow: 173.2,
            },
          ],
        ]),
      );
      stubClient(provider, { quote });
      const result = await provider.getQuotes(['AAPL']);
      expect(result.get('AAPL')?.open).toBe(174);
      expect(result.get('AAPL')?.high).toBe(176.8);
      expect(result.get('AAPL')?.low).toBe(173.2);
    });

    it('requests open/high/low in the batch fields whitelist', async () => {
      const quote = vi.fn().mockResolvedValue(new Map());
      stubClient(provider, { quote });
      await provider.getQuotes(['AAPL']);
      const fields = (quote.mock.calls[0]?.[1] as { fields?: string[] } | undefined)?.fields ?? [];
      expect(fields).toEqual(
        expect.arrayContaining(['regularMarketOpen', 'regularMarketDayHigh', 'regularMarketDayLow']),
      );
    });

    it('skips rows with a null price (no partial quotes)', async () => {
      stubClient(provider, {
        quote: vi.fn().mockResolvedValue(
          new Map([
            ['AAPL', { symbol: 'AAPL', regularMarketPrice: 175.5, regularMarketChangePercent: 0.69 }],
            ['BADX', { symbol: 'BADX', regularMarketPrice: null }],
          ]),
        ),
      });
      const result = await provider.getQuotes(['AAPL', 'BADX']);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('BADX')).toBe(false);
    });

    it('returns an empty Map for an empty symbol list without calling the client', async () => {
      const quote = vi.fn();
      stubClient(provider, { quote });
      const result = await provider.getQuotes([]);
      expect(result.size).toBe(0);
      expect(quote).not.toHaveBeenCalled();
    });

    it('maps 429 to RATE_LIMITED and trips the backoff', async () => {
      const quote = vi.fn().mockRejectedValue(new Error('Too Many Requests'));
      stubClient(provider, { quote });
      await expect(provider.getQuotes(['AAPL'])).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      // Inside the backoff window the next call short-circuits without hitting the client.
      await expect(provider.getQuotes(['MSFT'])).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(quote).toHaveBeenCalledTimes(1);
    });

    it('maps non-429 errors to PROVIDER_ERROR', async () => {
      stubClient(provider, { quote: vi.fn().mockRejectedValue(new Error('boom')) });
      await expect(provider.getQuotes(['AAPL'])).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });
  });
});

describe('YahooProvider.getHistory', () => {
  it('maps OHLCV and omits fields the upstream returned as null', async () => {
    const provider = new YahooProvider(RuntimeConfig.fromEnvironment());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = {
      chart: vi.fn().mockResolvedValue({
        quotes: [
          { date: new Date(1_000_000), open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
          { date: new Date(2_000_000), open: null, high: null, low: null, close: 2.5, volume: null },
          { date: new Date(3_000_000), close: null },
        ],
      }),
    };
    const bars = await provider.getHistory('AAPL', '1mo');
    expect(bars).toEqual([
      { time: 1000, open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
      { time: 2000, close: 2.5 },
    ]);
  });
});

describe('YahooProvider.getMarketMovers', () => {
  function stubClient(provider: YahooProvider, stubs: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = stubs;
  }

  const equity = (symbol: string, price: number, changePct: number) => ({
    symbol,
    shortName: `${symbol} Inc.`,
    quoteType: 'EQUITY',
    regularMarketPrice: price,
    regularMarketChangePercent: changePct,
  });

  it('maps a screener to items, keeping only tradable equities and capping at count', async () => {
    const provider = new YahooProvider(RuntimeConfig.fromEnvironment());
    const screener = vi.fn().mockResolvedValue({
      quotes: [
        equity('AAA', 10, 12.5),
        { ...equity('SPYX', 50, 9), quoteType: 'ETF' },
        equity('BBB', 20, 8),
        { ...equity('CCC', 30, 7), regularMarketPrice: undefined },
        equity('DDD', 40, 6),
      ],
    });
    stubClient(provider, { screener });

    const items = await provider.getMarketMovers('gainers', 2);

    expect(screener).toHaveBeenCalledWith({ scrIds: 'day_gainers', count: 6 });
    expect(items).toEqual([
      { symbol: 'AAA', name: 'AAA Inc.', price: 10, changePct: 12.5 },
      { symbol: 'BBB', name: 'BBB Inc.', price: 20, changePct: 8 },
    ]);
  });

  it('uses the most_actives screener for "active" and day_losers for "losers"', async () => {
    const provider = new YahooProvider(RuntimeConfig.fromEnvironment());
    const screener = vi.fn().mockResolvedValue({ quotes: [] });
    stubClient(provider, { screener });

    await provider.getMarketMovers('active', 5);
    await provider.getMarketMovers('losers', 5);

    expect(screener.mock.calls.map((c) => c[0].scrIds)).toEqual(['most_actives', 'day_losers']);
  });

  it('enriches trending tickers with a quote, dropping non-equities and odd tickers', async () => {
    const provider = new YahooProvider(RuntimeConfig.fromEnvironment());
    stubClient(provider, {
      trendingSymbols: vi.fn().mockResolvedValue({
        quotes: [{ symbol: 'ZZZ' }, { symbol: 'BTC-USD' }, { symbol: 'ES=F' }, { symbol: 'AAA' }],
      }),
      quote: vi.fn().mockResolvedValue(
        new Map<string, unknown>([
          ['AAA', equity('AAA', 10, 1)],
          ['ZZZ', equity('ZZZ', 5, -2)],
          ['BTC-USD', { ...equity('BTC-USD', 60000, 3), quoteType: 'CRYPTOCURRENCY' }],
        ]),
      ),
    });

    const items = await provider.getMarketMovers('trending', 5);

    expect(items.map((i) => i.symbol)).toEqual(['ZZZ', 'AAA']);
  });

  it('recovers a screener result from benign schema drift', async () => {
    const provider = new YahooProvider(RuntimeConfig.fromEnvironment());
    const validationErr = Object.assign(new Error('Failed Yahoo Schema validation'), {
      name: 'FailedYahooValidationError',
      result: { quotes: [equity('AAA', 10, 4)] },
    });
    stubClient(provider, { screener: vi.fn().mockRejectedValue(validationErr) });

    const items = await provider.getMarketMovers('gainers', 5);
    expect(items.map((i) => i.symbol)).toEqual(['AAA']);
  });

  it('maps a 429 to RATE_LIMITED and other failures to PROVIDER_ERROR', async () => {
    const limited = new YahooProvider(RuntimeConfig.fromEnvironment());
    stubClient(limited, { screener: vi.fn().mockRejectedValue(new Error('Too Many Requests')) });
    await expect(limited.getMarketMovers('gainers', 5)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });

    const broken = new YahooProvider(RuntimeConfig.fromEnvironment());
    stubClient(broken, { trendingSymbols: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(broken.getMarketMovers('trending', 5)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});

describe('YahooProvider.getFundamentals', () => {
  function withQuoteSummary(quoteSummary: unknown): YahooProvider {
    const provider = new YahooProvider(RuntimeConfig.fromEnvironment());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = { quoteSummary };
    return provider;
  }

  const DAY_MS = 86_400_000;

  function fullSummary() {
    return {
      summaryDetail: {
        currency: 'USD',
        marketCap: 3_000_000_000_000,
        trailingPE: 30.5,
        forwardPE: 27.1,
        beta: 1.2,
        dividendYield: 0.0045,
        payoutRatio: 0.15,
        fiftyTwoWeekLow: 160,
        fiftyTwoWeekHigh: 240,
        fiftyDayAverage: 220,
        twoHundredDayAverage: 205,
        priceToSalesTrailing12Months: 7.8,
        exDividendDate: new Date('2026-08-11T00:00:00Z'),
      },
      defaultKeyStatistics: {
        forwardPE: 99,
        beta: 99,
        profitMargins: 0.99,
        pegRatio: 2.1,
        priceToBook: 45.2,
        trailingEps: 6.5,
        forwardEps: 7.3,
        shortPercentOfFloat: 0.007,
      },
      financialData: {
        financialCurrency: 'USD',
        totalRevenue: 390_000_000_000,
        revenueGrowth: 0.06,
        earningsGrowth: 0.11,
        grossMargins: 0.46,
        operatingMargins: 0.31,
        profitMargins: 0.24,
        returnOnEquity: 1.5,
        freeCashflow: 100_000_000_000,
        totalDebt: 100_000_000_000,
        totalCash: 65_000_000_000,
        debtToEquity: 151.9,
        currentRatio: 0.87,
        recommendationKey: 'buy',
        targetMeanPrice: 250,
        numberOfAnalystOpinions: 38,
      },
      assetProfile: {
        sector: 'Technology',
        industry: 'Consumer Electronics',
        longBusinessSummary: 'Apple Inc. designs smartphones.',
        fullTimeEmployees: 164_000,
      },
      calendarEvents: {
        earnings: { earningsDate: [new Date(Date.now() + 10 * DAY_MS)] },
        exDividendDate: new Date('2026-08-12T00:00:00Z'),
      },
    };
  }

  it('maps every module field, preferring summaryDetail/financialData to key stats', async () => {
    const summary = fullSummary();
    const quoteSummary = vi.fn().mockResolvedValue(summary);
    const f = await withQuoteSummary(quoteSummary).getFundamentals('AAPL');

    expect(quoteSummary).toHaveBeenCalledWith('AAPL', {
      modules: [
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'assetProfile',
        'calendarEvents',
      ],
    });
    expect(f).toEqual({
      sector: 'Technology',
      industry: 'Consumer Electronics',
      businessSummary: 'Apple Inc. designs smartphones.',
      employees: 164_000,
      marketCap: 3_000_000_000_000,
      trailingPE: 30.5,
      forwardPE: 27.1,
      pegRatio: 2.1,
      priceToBook: 45.2,
      priceToSales: 7.8,
      beta: 1.2,
      trailingEps: 6.5,
      forwardEps: 7.3,
      dividendYield: 0.0045,
      payoutRatio: 0.15,
      fiftyTwoWeekLow: 160,
      fiftyTwoWeekHigh: 240,
      fiftyDayAverage: 220,
      twoHundredDayAverage: 205,
      totalRevenue: 390_000_000_000,
      revenueGrowth: 0.06,
      earningsGrowth: 0.11,
      grossMargins: 0.46,
      operatingMargins: 0.31,
      profitMargins: 0.24,
      returnOnEquity: 1.5,
      freeCashflow: 100_000_000_000,
      totalDebt: 100_000_000_000,
      totalCash: 65_000_000_000,
      debtToEquity: expect.closeTo(1.519, 10),
      currentRatio: 0.87,
      shortPercentOfFloat: 0.007,
      analystRecommendation: 'buy',
      analystTargetMean: 250,
      analystCount: 38,
      nextEarningsDate: summary.calendarEvents.earnings.earningsDate[0]!.toISOString(),
      exDividendDate: '2026-08-12T00:00:00.000Z',
    });
  });

  it('falls back to key statistics and drops missing, non-finite, and blank values', async () => {
    const f = await withQuoteSummary(
      vi.fn().mockResolvedValue({
        summaryDetail: { trailingPE: Number.NaN, marketCap: Infinity },
        defaultKeyStatistics: { forwardPE: 20, beta: 0.9, profitMargins: 0.1 },
        financialData: { recommendationKey: 'none' },
        assetProfile: { sector: '  ', industry: 'Banks' },
      }),
    ).getFundamentals('JPM');

    expect(f).toEqual({ industry: 'Banks', forwardPE: 20, beta: 0.9, profitMargins: 0.1 });
  });

  it('drops money in a non-USD currency but keeps the currency-free ratios', async () => {
    const summary = fullSummary();
    summary.financialData.financialCurrency = 'TWD';
    const f = await withQuoteSummary(vi.fn().mockResolvedValue(summary)).getFundamentals('TSM');

    expect(f.totalRevenue).toBeUndefined();
    expect(f.freeCashflow).toBeUndefined();
    expect(f.totalDebt).toBeUndefined();
    expect(f.totalCash).toBeUndefined();
    expect(f.trailingEps).toBeUndefined();
    expect(f.marketCap).toBe(3_000_000_000_000);
    expect(f.grossMargins).toBe(0.46);

    summary.summaryDetail.currency = 'EUR';
    const g = await withQuoteSummary(vi.fn().mockResolvedValue(summary)).getFundamentals('ASML.AS');
    expect(g.marketCap).toBeUndefined();
    expect(g.fiftyTwoWeekHigh).toBeUndefined();
    expect(g.analystTargetMean).toBeUndefined();
    expect(g.trailingPE).toBe(30.5);
  });

  it('truncates a long business summary on a word boundary with an ellipsis', async () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' \n ');
    const f = await withQuoteSummary(
      vi.fn().mockResolvedValue({ assetProfile: { longBusinessSummary: long } }),
    ).getFundamentals('AAPL');

    expect(f.businessSummary!.length).toBeLessThanOrEqual(600);
    expect(f.businessSummary!.endsWith('…')).toBe(true);
    expect(f.businessSummary).toMatch(/^word0 word1 /);
    expect(f.businessSummary).toMatch(/ word\d+…$/);
  });

  it('normalises Date, epoch s/ms, ISO strings and {raw} wrappers to ISO UTC', async () => {
    const iso = '2026-11-05T21:00:00.000Z';
    const ms = Date.parse(iso);
    const cases: unknown[] = [new Date(ms), ms / 1000, ms, iso, { raw: ms / 1000, fmt: 'x' }];
    for (const exDividendDate of cases) {
      const f = await withQuoteSummary(
        vi.fn().mockResolvedValue({ calendarEvents: { exDividendDate, earnings: {} } }),
      ).getFundamentals('AAPL');
      expect(f.exDividendDate).toBe(iso);
    }

    const garbage = await withQuoteSummary(
      vi.fn().mockResolvedValue({ calendarEvents: { exDividendDate: 'soon', earnings: {} } }),
    ).getFundamentals('AAPL');
    expect(garbage.exDividendDate).toBeUndefined();
  });

  it('picks the earliest earnings date that is not in the past, else the first', async () => {
    const past = new Date(Date.now() - 30 * DAY_MS);
    const near = new Date(Date.now() + 5 * DAY_MS);
    const far = new Date(Date.now() + 9 * DAY_MS);
    const withEarnings = (earningsDate: Date[]) =>
      withQuoteSummary(vi.fn().mockResolvedValue({ calendarEvents: { earnings: { earningsDate } } }));

    const upcoming = await withEarnings([past, far, near]).getFundamentals('AAPL');
    expect(upcoming.nextEarningsDate).toBe(near.toISOString());

    const older = new Date(Date.now() - 60 * DAY_MS);
    const allPast = await withEarnings([past, older]).getFundamentals('AAPL');
    expect(allPast.nextEarningsDate).toBe(past.toISOString());
  });

  it('recovers a half-coerced payload from FailedYahooValidationError', async () => {
    const earnings = Math.floor((Date.now() + 3 * DAY_MS) / 1000);
    const validationErr = Object.assign(new Error('Failed Yahoo Schema validation'), {
      name: 'FailedYahooValidationError',
      result: {
        summaryDetail: { marketCap: { raw: 5e9, fmt: '5B' }, trailingPE: {}, currency: 'USD' },
        financialData: { totalRevenue: 1e9, financialCurrency: 'USD' },
        calendarEvents: { earnings: { earningsDate: [earnings] }, exDividendDate: {} },
      },
    });
    const provider = withQuoteSummary(vi.fn().mockRejectedValue(validationErr));
    const f = await provider.getFundamentals('AAPL');

    expect(f).toEqual({
      marketCap: 5e9,
      totalRevenue: 1e9,
      nextEarningsDate: new Date(earnings * 1000).toISOString(),
    });
  });

  it('maps a validation error without a recoverable result to PROVIDER_ERROR', async () => {
    const validationErr = Object.assign(new Error('Failed Yahoo Schema validation'), {
      name: 'FailedYahooValidationError',
      result: null,
    });
    await expect(
      withQuoteSummary(vi.fn().mockRejectedValue(validationErr)).getFundamentals('AAPL'),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('maps a 429 to RATE_LIMITED and trips the backoff', async () => {
    const quoteSummary = vi.fn().mockRejectedValue(new Error('Too Many Requests'));
    const provider = withQuoteSummary(quoteSummary);
    await expect(provider.getFundamentals('AAPL')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(provider.getFundamentals('MSFT')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(quoteSummary).toHaveBeenCalledTimes(1);
  });

  it('maps an unknown symbol to SYMBOL_NOT_FOUND', async () => {
    const notFound = new Error('Quote not found for symbol: ZZZZ');
    await expect(
      withQuoteSummary(vi.fn().mockRejectedValue(notFound)).getFundamentals('ZZZZ'),
    ).rejects.toMatchObject({ code: 'SYMBOL_NOT_FOUND' });

    const http404 = Object.assign(new Error('Not Found'), { name: 'HTTPError', code: 404 });
    await expect(
      withQuoteSummary(vi.fn().mockRejectedValue(http404)).getFundamentals('ZZZZ'),
    ).rejects.toMatchObject({ code: 'SYMBOL_NOT_FOUND' });

    await expect(
      withQuoteSummary(vi.fn().mockResolvedValue({})).getFundamentals('ZZZZ'),
    ).rejects.toMatchObject({ code: 'SYMBOL_NOT_FOUND' });
  });

  it('maps other failures to PROVIDER_ERROR', async () => {
    await expect(
      withQuoteSummary(vi.fn().mockRejectedValue(new Error('boom'))).getFundamentals('AAPL'),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { StockQuote } from '@markettrader/shared';

vi.mock('../src/api/stocks', () => ({
  useStockSearch: vi.fn(),
  useStockQuote: vi.fn(),
  useStockDetails: vi.fn(),
}));
vi.mock('../src/api/trades', () => ({
  usePortfolio: vi.fn(),
  usePlaceTrade: vi.fn(),
}));

import {
  useStockSearch,
  useStockQuote,
  useStockDetails,
} from '../src/api/stocks';
import { usePortfolio, usePlaceTrade } from '../src/api/trades';
import { useLiveStore } from '../src/stores/liveStore';
import { TradeOrderDialog } from '../src/components/TradeOrderDialog';

const PRICE = 100;
const SYMBOL = 'AAPL';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

const liveQuote: StockQuote = {
  symbol: SYMBOL,
  price: PRICE,
  change: 0,
  changePercent: 0,
  fetchedAt: '2026-05-14T00:00:00Z',
};

const baseProps = {
  open: true,
  initialSymbol: SYMBOL,
  gameId: 'g1',
  allowShortSelling: false,
  allowLimitOrders: true,
  allowStopOrders: true,
  allowBracketOrders: true,
  allowGTC: true,
  onOpenChange: vi.fn(),
  onSeeQuote: vi.fn(),
};

const placeMutate = vi.fn();

beforeEach(() => {
  vi.mocked(useStockSearch).mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useStockSearch>);
  vi.mocked(useStockQuote).mockReturnValue({
    data: liveQuote,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useStockQuote>);
  vi.mocked(useStockDetails).mockReturnValue({
    data: { symbol: SYMBOL, companyName: 'Apple Inc.', exchange: 'NASDAQ', price: PRICE },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useStockDetails>);
  vi.mocked(usePortfolio).mockReturnValue({
    data: {
      cashBalance: 100_000,
      holdings: [
        {
          symbol: SYMBOL,
          quantity: 50,
          avgCostBasis: 90,
          currentPrice: PRICE,
          marketValue: 50 * PRICE,
          unrealizedPnL: 500,
          unrealizedPnLPercent: 11.11,
        },
      ],
      totalValue: 105_000,
      reservedValue: 0,
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePortfolio>);
  placeMutate.mockReset();
  placeMutate.mockResolvedValue({ kind: 'executed', priceWasStale: false });
  vi.mocked(usePlaceTrade).mockReturnValue({
    mutateAsync: placeMutate,
    isPending: false,
  } as unknown as ReturnType<typeof usePlaceTrade>);
  useLiveStore.setState({
    pricesBySymbol: { [SYMBOL]: liveQuote },
    historyBySymbol: {},
    leaderboard: null,
    recentTrades: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function submitBtn() {
  return screen.getByRole('button', { name: /submit order/i });
}

function termButtons() {
  return {
    day: screen.getByRole('button', { name: /day order/i }),
    gtc: screen.getByRole('button', { name: /good til canceled/i }),
  };
}

async function selectPriceType(
  user: ReturnType<typeof userEvent.setup>,
  value: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' | 'BRACKET',
) {
  await user.selectOptions(screen.getByLabelText(/price type/i), value);
}

describe('TradeOrderDialog', () => {
  it('enables the submit button for a default MARKET buy', () => {
    render(wrap(<TradeOrderDialog {...baseProps} />));
    expect(submitBtn()).toBeEnabled();
  });

  it('disables the term toggle when the price type is MARKET', () => {
    render(wrap(<TradeOrderDialog {...baseProps} />));
    const { day, gtc } = termButtons();
    expect(day).toBeDisabled();
    expect(gtc).toBeDisabled();
    expect(day).toHaveAttribute(
      'title',
      'Time-in-force does not apply to market orders',
    );
  });

  it('re-enables the term toggle after switching MARKET → LIMIT', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'LIMIT');
    const { day, gtc } = termButtons();
    expect(day).toBeEnabled();
    expect(gtc).toBeEnabled();
  });

  it('LIMIT requires a positive limitPrice', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'LIMIT');
    // Effect auto-fills "100.00", so submit is enabled to start.
    expect(submitBtn()).toBeEnabled();

    const limit = screen.getByLabelText(/limit price/i);
    // Setting "0" keeps the field non-empty (so the auto-fill effect doesn't
    // re-populate) but fails the `> 0` validity check.
    fireEvent.change(limit, { target: { value: '0' } });
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(limit, { target: { value: '50' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('STOP requires a positive stopPrice', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'STOP');
    expect(submitBtn()).toBeEnabled();

    const stop = screen.getByLabelText(/stop price/i);
    fireEvent.change(stop, { target: { value: '0' } });
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(stop, { target: { value: '120' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('STOP_LIMIT requires both limit and stop > 0', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'STOP_LIMIT');
    const limit = screen.getByLabelText(/limit price/i);
    const stop = screen.getByLabelText(/stop price/i);

    fireEvent.change(stop, { target: { value: '0' } });
    fireEvent.change(limit, { target: { value: '0' } });
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(stop, { target: { value: '100' } });
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(limit, { target: { value: '101' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('BRACKET buy: take profit must exceed stop loss', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'BRACKET');

    const tp = screen.getByLabelText(/take profit/i);
    const sl = screen.getByLabelText(/stop loss/i);
    fireEvent.change(tp, { target: { value: '90' } });
    fireEvent.change(sl, { target: { value: '100' } });
    expect(submitBtn()).toBeDisabled();
    expect(
      screen.getByText(/take profit must be greater than stop loss/i),
    ).toBeInTheDocument();

    fireEvent.change(tp, { target: { value: '110' } });
    fireEvent.change(sl, { target: { value: '90' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('BRACKET sell: take profit must be below stop loss', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await user.click(screen.getByRole('button', { name: /^sell$/i }));
    await selectPriceType(user, 'BRACKET');

    const tp = screen.getByLabelText(/take profit/i);
    const sl = screen.getByLabelText(/stop loss/i);
    fireEvent.change(tp, { target: { value: '110' } });
    fireEvent.change(sl, { target: { value: '90' } });
    expect(submitBtn()).toBeDisabled();
    expect(
      screen.getByText(/take profit must be less than stop loss/i),
    ).toBeInTheDocument();

    fireEvent.change(tp, { target: { value: '90' } });
    fireEvent.change(sl, { target: { value: '110' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('submits a LIMIT buy with the expected payload', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'LIMIT');

    const limit = screen.getByLabelText(/limit price/i);
    fireEvent.change(limit, { target: { value: '95' } });
    await user.click(submitBtn());

    expect(placeMutate).toHaveBeenCalledTimes(1);
    expect(placeMutate).toHaveBeenCalledWith({
      symbol: SYMBOL,
      direction: 'buy',
      quantity: 1,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 95,
    });
  });

  it('disables submit when selling with no holdings', () => {
    vi.mocked(usePortfolio).mockReturnValue({
      data: {
        cashBalance: 100_000,
        holdings: [],
        totalValue: 100_000,
        reservedValue: 0,
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePortfolio>);

    render(wrap(<TradeOrderDialog {...baseProps} />));
    // Switch to Sell via the direction tab.
    fireEvent.click(screen.getByRole('button', { name: /^sell$/i }));
    expect(submitBtn()).toBeDisabled();
  });

  it('switches to GTC and submits with timeInForce=gtc', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeOrderDialog {...baseProps} />));
    await selectPriceType(user, 'LIMIT');

    const limit = screen.getByLabelText(/limit price/i);
    fireEvent.change(limit, { target: { value: '95' } });

    await user.click(termButtons().gtc);
    await user.click(submitBtn());

    expect(placeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ timeInForce: 'gtc' }),
    );
  });
});

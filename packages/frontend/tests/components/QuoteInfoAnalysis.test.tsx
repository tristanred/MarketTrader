import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  AnalysisErrorBody,
  StockAnalysisPending,
  StockAnalysisStatus,
} from '@markettrader/shared';

const apiFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});
const capture = vi.fn();
vi.mock('@/lib/posthog', () => ({ capture: (...args: unknown[]) => capture(...args) }));
vi.mock('@/api/stocks', () => ({
  useStockDetails: () => ({ data: undefined, isError: false }),
  useStockSearch: () => ({ data: [] }),
}));
vi.mock('@/api/market-status', () => ({ useMarketStatus: () => ({ data: undefined }) }));
vi.mock('@/api/trades', () => ({ usePortfolio: () => ({ data: undefined }) }));
vi.mock('@/components/StockChart', () => ({ ChartCanvas: () => null, RANGES: [] }));

import { ApiError } from '@/lib/api';
import { QuoteInfo, type QuoteInfoProps } from '@/components/QuoteInfo';
import { stockAnalysisKeys } from '@/api/stock-analysis';
import { ANALYSIS_WAIT_CAP_MS } from '@/components/analysis/useStockAnalysis';
import { response, status, usage } from './analysis/fixtures';

function route(
  handlers: { post?: () => Promise<unknown>; status?: () => StockAnalysisStatus } = {},
) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith('/analysis/status')) return Promise.resolve((handlers.status ?? status)());
    if (init?.method === 'POST' && handlers.post) return handlers.post();
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderQuote(props: Partial<QuoteInfoProps> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (p: Partial<QuoteInfoProps>) => (
    <QueryClientProvider client={qc}>
      <QuoteInfo symbol="AAPL" variant="full" showTradeButton={false} {...props} {...p} />
    </QueryClientProvider>
  );
  const view = render(wrap({}));
  return {
    qc,
    rerender: (p: Partial<QuoteInfoProps>) => {
      view.rerender(wrap(p));
    },
  };
}

describe('QuoteInfo analysis', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    capture.mockReset();
  });

  it('opens the panel with the result and records the request', async () => {
    route({ post: () => Promise.resolve(response()) });
    renderQuote();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Analyze' }));

    expect(await screen.findByText('BUY')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('stock_analysis_requested', {
      symbol: 'AAPL',
      surface: 'symbol_page',
    });
    expect(apiFetch).toHaveBeenCalledWith('/stocks/AAPL/analysis', { method: 'POST' });
  });

  it('records the quote dialog as the surface in compact mode and stacks the cases', async () => {
    route({ post: () => Promise.resolve(response()) });
    renderQuote({ variant: 'compact' });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Analyze' }));

    expect(await screen.findByTestId('analysis-cases')).not.toHaveClass('sm:grid-cols-2');
    expect(capture).toHaveBeenCalledWith('stock_analysis_requested', {
      symbol: 'AAPL',
      surface: 'quote_dialog',
    });
  });

  it('dismisses the result when the symbol changes', async () => {
    route({ post: () => Promise.resolve(response()) });
    const { rerender } = renderQuote();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Analyze' }));
    expect(await screen.findByText('BUY')).toBeInTheDocument();

    rerender({ symbol: 'MSFT' });

    await waitFor(() => expect(screen.queryByRole('region', { name: /analysis/i })).toBeNull());
    expect(screen.queryByText('BUY')).toBeNull();
  });

  it('detaches an in-flight request from the next symbol', async () => {
    let resolvePost: (v: unknown) => void = () => {};
    route({ post: () => new Promise((resolve) => (resolvePost = resolve)) });
    const { qc, rerender } = renderQuote();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Analyze' }));
    expect(await screen.findByRole('button', { name: 'Analyzing…' })).toBeDisabled();

    rerender({ symbol: 'MSFT' });

    expect(await screen.findByRole('button', { name: 'Analyze' })).toBeEnabled();
    resolvePost(response());
    await waitFor(() =>
      expect(qc.getQueryData<StockAnalysisStatus>(stockAnalysisKeys.status('AAPL'))?.cached).toBe(
        true,
      ),
    );
    expect(qc.getQueryData<StockAnalysisStatus>(stockAnalysisKeys.status('MSFT'))?.cached).toBe(
      false,
    );
    expect(screen.queryByText('BUY')).toBeNull();
  });

  it('hides the panel on dismiss', async () => {
    route({ post: () => Promise.resolve(response()) });
    renderQuote();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Analyze' }));
    await screen.findByText('BUY');

    await user.click(screen.getByRole('button', { name: 'Dismiss analysis' }));

    expect(screen.queryByText('BUY')).toBeNull();
  });

  it('re-requests on Try again after a failure', async () => {
    const failed: AnalysisErrorBody = { error: 'x', code: 'ANALYSIS_FAILED' };
    const post = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError(502, failed, '502 Bad Gateway'))
      .mockResolvedValueOnce(response());
    route({ post });
    renderQuote();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Analyze' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('BUY')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});

describe('QuoteInfo analysis that outlives its POST (202)', () => {
  const generating = (): StockAnalysisPending => ({ status: 'generating', usage: usage() });
  const statusCalls = (symbol: string) =>
    apiFetch.mock.calls.filter(([p]) => p === `/stocks/${symbol}/analysis/status`).length;
  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    apiFetch.mockReset();
    capture.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function clickAnalyze() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: /^analyz/i }));
    return user;
  }

  /** A server whose first POST answers 202 and flips the status to generating. */
  function slowServer(post?: () => Promise<unknown>) {
    const server = { current: status() };
    route({
      post:
        post ??
        (() => {
          server.current = status({ generating: true });
          return Promise.resolve(generating());
        }),
      status: () => server.current,
    });
    return server;
  }

  it('polls until the analysis is cached, then fetches it with a second POST', async () => {
    const post = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => {
        server.current = status({ generating: true });
        return Promise.resolve(generating());
      })
      .mockResolvedValueOnce(response({ source: 'cache' }));
    const server = slowServer(post);
    renderQuote();

    await clickAnalyze();
    expect(
      await screen.findByText('Analyzing AAPL… this can take up to a minute.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();

    await tick(2_600);
    expect(post).toHaveBeenCalledTimes(1);

    server.current = status({ cached: true });
    await tick(2_600);

    expect(await screen.findByText('BUY')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  // The server joins a same-symbol request to the running generation, so a 409 only
  // ever means "your generation for another symbol is still running" — this symbol's
  // status shows nothing generating, and polling it would report a false failure.
  it('says an earlier analysis is still running on a 409, without polling or a retry', async () => {
    const inProgress: AnalysisErrorBody = { error: 'x', code: 'ANALYSIS_IN_PROGRESS' };
    const post = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError(409, inProgress, '409 Conflict'));
    const server = slowServer(post);
    server.current = status({ generating: false, cached: false });
    renderQuote();

    await clickAnalyze();
    expect(await screen.findByText('An analysis you started is still running.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    await tick(10_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Couldn't generate/)).toBeNull();
  });

  it('shows a failure the background generation reported after the click', async () => {
    const server = slowServer();
    renderQuote();
    await clickAnalyze();

    server.current = status({
      lastFailure: {
        error: 'x',
        code: 'ANALYSIS_CAPACITY',
        retryAfterSeconds: 600,
        failedAt: new Date(Date.now() + 1_000).toISOString(),
      },
    });
    await tick(2_600);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Analysis is temporarily unavailable. Try again in 10 minutes.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers Try again when the background generation timed out', async () => {
    const post = vi.fn<() => Promise<unknown>>().mockImplementation(() => {
      server.current = status({ generating: true });
      return Promise.resolve(generating());
    });
    const server = slowServer(post);
    renderQuote();
    const user = await clickAnalyze();

    server.current = status({
      lastFailure: {
        error: 'x',
        code: 'ANALYSIS_TIMEOUT',
        failedAt: new Date(Date.now() + 1_000).toISOString(),
      },
    });
    await tick(2_600);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't generate an analysis. This didn't use one of your analyses.",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('ignores a failure older than the click and shows the generic copy', async () => {
    const clickedAt = Date.now();
    const server = slowServer();
    renderQuote();
    await clickAnalyze();

    server.current = status({
      lastFailure: {
        error: 'x',
        code: 'ANALYSIS_CAPACITY',
        retryAfterSeconds: 600,
        failedAt: new Date(clickedAt - 60_000).toISOString(),
      },
    });
    await tick(2_600);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't generate an analysis. This didn't use one of your analyses.",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('stops polling when the symbol changes', async () => {
    slowServer();
    const { rerender } = renderQuote();
    await clickAnalyze();
    await tick(2_600);
    expect(statusCalls('AAPL')).toBeGreaterThan(1);

    rerender({ symbol: 'MSFT' });
    await tick(100);
    const before = statusCalls('AAPL');
    await tick(10_000);

    expect(statusCalls('AAPL')).toBe(before);
    expect(screen.queryByText(/Analyzing AAPL/)).toBeNull();
  });

  it('stops polling on dismiss', async () => {
    slowServer();
    renderQuote();
    const user = await clickAnalyze();
    await tick(2_600);

    await user.click(screen.getByRole('button', { name: 'Dismiss analysis' }));
    const before = statusCalls('AAPL');
    await tick(10_000);

    expect(statusCalls('AAPL')).toBe(before);
  });

  it('never joins a running generation on load without a click', async () => {
    route({ status: () => status({ generating: true }) });
    renderQuote();

    const button = await screen.findByRole('button', { name: 'Analyzing…' });
    expect(button).toBeEnabled();
    await tick(10_000);

    expect(screen.queryByRole('region', { name: /analysis/i })).toBeNull();
    expect(statusCalls('AAPL')).toBe(1);
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('joins a running generation on click, and POSTs once it is cached', async () => {
    const server = { current: status({ generating: true }) };
    const post = vi.fn<() => Promise<unknown>>().mockResolvedValue(response());
    route({ post, status: () => server.current });
    renderQuote();

    await clickAnalyze();
    expect(await screen.findByText(/Analyzing AAPL/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    server.current = status({ cached: true });
    await tick(2_600);

    expect(await screen.findByText('BUY')).toBeInTheDocument();
    expect(post).toHaveBeenCalledOnce();
  });

  it('gives up after four minutes with Try again, and stops polling', async () => {
    slowServer();
    renderQuote();
    await clickAnalyze();

    await tick(ANALYSIS_WAIT_CAP_MS - 5_000);
    expect(screen.queryByRole('alert')).toBeNull();
    await tick(5_000);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The analysis is taking longer than usual. Try again in a few minutes.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const before = statusCalls('AAPL');
    await tick(10_000);
    expect(statusCalls('AAPL')).toBe(before);
  });
});

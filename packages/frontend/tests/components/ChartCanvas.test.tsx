import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createChart = vi.fn();

// A callable proxy that answers every property access and call with itself, so
// ChartCanvas can drive the chart API without a real canvas.
const stub: unknown = new Proxy(function () {}, {
  get: () => stub,
  apply: () => stub,
});

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightweight-charts')>();
  return {
    ...actual,
    createChart: (...args: unknown[]) => {
      createChart(...args);
      return stub;
    },
    createSeriesMarkers: () => stub,
  };
});
vi.mock('@/api/stocks', () => ({ useStockHistory: () => ({ data: undefined }) }));
vi.mock('@/api/market-status', () => ({ useMarketStatus: () => ({ data: undefined }) }));
vi.mock('@/api/trades', () => ({
  useTradeHistory: () => ({ data: undefined }),
  usePortfolio: () => ({ data: undefined }),
}));

import { ChartCanvas } from '@/components/StockChart';

beforeEach(() => createChart.mockReset());

describe('ChartCanvas wheel handling', () => {
  it('zooms and pans on the mouse wheel by default', () => {
    render(<ChartCanvas symbol="AAPL" range="1d" />);
    const options = createChart.mock.calls[0]?.[1];
    expect(options.handleScroll?.mouseWheel).not.toBe(false);
    expect(options.handleScale?.mouseWheel).not.toBe(false);
  });

  it('leaves the wheel to the page when wheel zoom is off', () => {
    render(<ChartCanvas symbol="AAPL" range="1d" wheelZoom={false} />);
    const options = createChart.mock.calls[0]?.[1];
    expect(options.handleScroll).toMatchObject({ mouseWheel: false });
    expect(options.handleScale).toMatchObject({ mouseWheel: false });
  });
});

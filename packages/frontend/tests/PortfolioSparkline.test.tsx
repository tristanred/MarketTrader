import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PortfolioSparkline } from '@/components/charts/PortfolioSparkline';

const POINTS = [
  { t: '2026-05-15T10:00:00.000Z', v: 100000, r: 1 },
  { t: '2026-05-16T10:00:00.000Z', v: 102000, r: 1 },
  { t: '2026-05-17T10:00:00.000Z', v: 105000, r: 1 },
];

describe('PortfolioSparkline', () => {
  it('renders nothing visible but a baseline when points are empty', () => {
    const { container } = render(
      <PortfolioSparkline
        points={[]}
        color="var(--accent)"
        startingBalance={100000}
        ariaLabel="empty"
      />,
    );
    // Empty state still emits a single dashed baseline line.
    expect(container.querySelectorAll('line').length).toBe(1);
    expect(container.querySelector('path')).toBeNull();
  });

  it('renders a path and an end-dot when points are present', () => {
    const { container } = render(
      <PortfolioSparkline
        points={POINTS}
        color="var(--accent)"
        startingBalance={100000}
        ariaLabel="alice"
      />,
    );
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    // Path should contain N-1 line segments (M + L commands)
    expect(path!.getAttribute('d')).toMatch(/^M[\d.\s]+L[\d.\s]+L/);
    expect(container.querySelector('circle')).not.toBeNull();
  });

  it('places the dashed baseline at the starting balance', () => {
    const { container } = render(
      <PortfolioSparkline
        points={POINTS}
        color="var(--accent)"
        startingBalance={100000}
        width={240}
        height={24}
      />,
    );
    // With min=100000 max=105000 starting=100000, baseline projects to y=22
    // (bottom of the chart area minus the 2px padding).
    const baseline = container.querySelector('line');
    expect(baseline).not.toBeNull();
    expect(Number(baseline!.getAttribute('y1'))).toBeCloseTo(22, 0);
  });

  it('passes through the aria-label for accessibility', () => {
    const { container } = render(
      <PortfolioSparkline
        points={POINTS}
        color="var(--accent)"
        startingBalance={100000}
        ariaLabel="alice up 5%"
      />,
    );
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('alice up 5%');
  });
});

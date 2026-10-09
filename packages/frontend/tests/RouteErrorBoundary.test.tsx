import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const captureException = vi.fn();
vi.mock('@/lib/posthog', () => ({ captureException }));

const { RouteErrorBoundary } = await import('../src/App');

function Boom(): never {
  throw new Error('chunk failed');
}

describe('RouteErrorBoundary', () => {
  it('shows the reload prompt and reports the caught error', () => {
    // React logs caught errors to console.error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText("Couldn't load this page.")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'chunk failed' }),
      expect.objectContaining({ boundary: 'route' }),
    );
  });
});

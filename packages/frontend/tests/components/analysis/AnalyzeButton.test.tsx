import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AnalyzeButton } from '@/components/analysis/AnalyzeButton';
import { status, usage } from './fixtures';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000 - 1_000).toISOString();

function button() {
  return screen.getByRole('button', { name: /analy/i });
}

describe('AnalyzeButton', () => {
  it('renders nothing while the status is unknown', () => {
    const { container } = render(
      <AnalyzeButton status={null} pending={false} onAnalyze={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when the server has no LLM configured', () => {
    const { container } = render(
      <AnalyzeButton status={status({ enabled: false })} pending={false} onAnalyze={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining allowance and calls onAnalyze on click', async () => {
    const onAnalyze = vi.fn();
    render(<AnalyzeButton status={status()} pending={false} onAnalyze={onAnalyze} />);
    expect(screen.getByText('7 of 10 left today')).toBeInTheDocument();
    await userEvent.setup().click(button());
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it('says a cached result is free to view', () => {
    render(<AnalyzeButton status={status({ cached: true })} pending={false} onAnalyze={vi.fn()} />);
    expect(screen.getByText('Already analyzed — free to view')).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it('is disabled when the allowance is spent and nothing is cached', () => {
    render(
      <AnalyzeButton
        status={status({ usage: usage({ used: 10, remaining: 0, nextSlotAt: inHours(5) }) })}
        pending={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(button()).toBeDisabled();
    expect(screen.getByText('Daily limit reached · resets in 5 hours')).toBeInTheDocument();
  });

  it('drops the reset time when the server does not know it', () => {
    render(
      <AnalyzeButton
        status={status({ usage: usage({ used: 10, remaining: 0, nextSlotAt: null }) })}
        pending={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(screen.getByText('Daily limit reached')).toBeInTheDocument();
  });

  it('stays enabled for a cached result even with the allowance spent', () => {
    render(
      <AnalyzeButton
        status={status({ cached: true, usage: usage({ used: 10, remaining: 0 }) })}
        pending={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(button()).toBeEnabled();
    expect(screen.getByText('Already analyzed — free to view')).toBeInTheDocument();
  });

  it('is disabled while the upstream is paused and nothing is cached', () => {
    const retryAt = new Date(Date.now() + 12 * 60_000 - 1_000).toISOString();
    render(
      <AnalyzeButton
        status={status({ available: false, retryAt })}
        pending={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(button()).toBeDisabled();
    expect(screen.getByText('Analysis unavailable · try again in 12 minutes')).toBeInTheDocument();
  });

  it('stays enabled during an outage when a cached result exists', () => {
    render(
      <AnalyzeButton
        status={status({ available: false, cached: true, retryAt: inHours(1) })}
        pending={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(button()).toBeEnabled();
  });

  it('has no caption for an unlimited account', () => {
    render(
      <AnalyzeButton
        status={status({ usage: usage({ limit: null, remaining: null }) })}
        pending={false}
        onAnalyze={vi.fn()}
      />,
    );
    expect(button()).toBeEnabled();
    expect(screen.queryByText(/left today/)).toBeNull();
  });

  it('shows a generation it did not start as busy but still clickable', async () => {
    const onAnalyze = vi.fn();
    render(
      <AnalyzeButton status={status({ generating: true })} pending={false} onAnalyze={onAnalyze} />,
    );
    const b = screen.getByRole('button', { name: 'Analyzing…' });
    expect(b).toBeEnabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/left today/)).toBeNull();
    await userEvent.setup().click(b);
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it('shows a busy, disabled "Analyzing…" with no caption while pending', () => {
    render(<AnalyzeButton status={status()} pending onAnalyze={vi.fn()} />);
    const b = screen.getByRole('button', { name: 'Analyzing…' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/left today/)).toBeNull();
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { AnalysisErrorBody, LimitExceededBody } from '@markettrader/shared';
import { ApiError } from '@/lib/api';
import { AnalysisPanel, type AnalysisPanelProps } from '@/components/analysis/AnalysisPanel';
import { confidenceWord, describeAnalysisError } from '@/components/analysis/analysisCopy';
import { analysis, response, usage } from './fixtures';

// `error` is the raw thrown value here, so the mapping is exercised end to end.
function renderPanel({
  error,
  ...over
}: Partial<Omit<AnalysisPanelProps, 'error'>> & { error?: unknown } = {}) {
  const props: AnalysisPanelProps = {
    symbol: 'AAPL',
    pending: false,
    result: response(),
    alwaysStacked: false,
    onDismiss: vi.fn(),
    onRetry: vi.fn(),
    ...over,
    error: error === undefined || error === null ? null : describeAnalysisError(error),
  };
  render(<AnalysisPanel {...props} />);
  return props;
}

function analysisError(status: number, body: AnalysisErrorBody) {
  return new ApiError(status, body, `${status} Error`);
}

describe('AnalysisPanel result', () => {
  it('renders the verdict, confidence word, summary and both cases as text', () => {
    renderPanel();
    expect(screen.getByText('BUY')).toHaveClass('text-gain');
    const confidence = screen.getByText('High confidence');
    expect(confidence).toHaveAttribute('title', 'Confidence 78/100');
    expect(screen.getByText(/Services growth and margin expansion/)).toBeInTheDocument();
    expect(screen.getByText('Services revenue +14% y/y')).toBeInTheDocument();
    expect(screen.getByText('Earnings in 9 days')).toBeInTheDocument();
    expect(screen.getByText('Bull case')).toBeInTheDocument();
    expect(screen.getByText('Bear case')).toBeInTheDocument();
    expect(screen.getByText('Analyzed 3 h ago')).toBeInTheDocument();
  });

  it('never interprets model text as markup', () => {
    renderPanel({
      result: response({ analysis: analysis({ summary: '<b>bold</b> **not markdown**' }) }),
    });
    expect(screen.getByText('<b>bold</b> **not markdown**')).toBeInTheDocument();
    expect(document.querySelector('section b')).toBeNull();
  });

  it('lights the verdict segment of the rating rail', () => {
    renderPanel({ result: response({ analysis: analysis({ verdict: 'SELL' }) }) });
    const rail = screen.getByTestId('rating-rail');
    expect(rail).toHaveAttribute('aria-hidden', 'true');
    const lit = rail.querySelectorAll('[data-lit="true"]');
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveTextContent('Sell');
    expect(screen.getByText('SELL')).toHaveClass('text-loss');
  });

  it('shows HOLD in the neutral strong text colour', () => {
    renderPanel({ result: response({ analysis: analysis({ verdict: 'HOLD' }) }) });
    expect(screen.getByText('HOLD')).toHaveClass('text-text-strong');
  });

  it('puts bull and bear side by side from sm up, or always stacks them', () => {
    renderPanel();
    expect(screen.getByTestId('analysis-cases')).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
  });

  it('keeps the cases in one column when asked to (the in-game dialog)', () => {
    renderPanel({ alwaysStacked: true });
    const cases = screen.getByTestId('analysis-cases');
    expect(cases).toHaveClass('grid-cols-1');
    expect(cases).not.toHaveClass('sm:grid-cols-2');
  });

  it('shows the price, disclaimer, model and remaining count in the footer', () => {
    renderPanel();
    expect(screen.getByText(/AI-generated from market data at/)).toHaveTextContent(
      'AI-generated from market data at $231.40. Not financial advice.',
    );
    expect(
      screen.getByText('Model: meta-llama/llama-3.3-70b-instruct · 6 of 10 left today'),
    ).toBeInTheDocument();
  });

  it('omits the model when none was reported, and the count when unlimited', () => {
    renderPanel({
      result: response({
        analysis: analysis({ reportedModel: null }),
        usage: usage({ limit: null, remaining: null }),
      }),
    });
    expect(screen.queryByText(/Model:/)).toBeNull();
    expect(screen.queryByText(/left today/)).toBeNull();
  });

  it('dismisses', async () => {
    const props = renderPanel();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss analysis' }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });
});

describe('AnalysisPanel pending', () => {
  it('sweeps the rail and says how long it can take', () => {
    renderPanel({ pending: true, result: null });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Analyzing AAPL… this can take up to a minute.',
    );
    expect(screen.getByTestId('rating-rail-sweep')).toBeInTheDocument();
    expect(screen.getByTestId('rating-rail').querySelector('[data-lit]')).toBeNull();
  });
});

describe('AnalysisPanel errors', () => {
  it('renders a limit refusal through formatLimitMessage', () => {
    const body: LimitExceededBody = {
      error: "You've used all 10 analyses for today",
      code: 'LIMIT_EXCEEDED',
      limit: 'stockAnalyses',
      max: 10,
      probation: false,
      retryAfterSeconds: 5 * 3_600,
    };
    renderPanel({ result: null, error: new ApiError(429, body, '429 Too Many Requests') });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "You've used all 10 analyses for today. You can try again in 5 hours.",
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('adds the probation notice to a limit refusal for a new account', () => {
    const body: LimitExceededBody = {
      error: "You've used all 3 analyses for today",
      code: 'LIMIT_EXCEEDED',
      limit: 'stockAnalyses',
      max: 3,
      probation: true,
      maturityDays: 7,
    };
    renderPanel({ result: null, error: new ApiError(429, body, '429 Too Many Requests') });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'New accounts have lower limits for their first 7 days.',
    );
  });

  it.each(['ANALYSIS_UNAVAILABLE', 'ANALYSIS_CAPACITY'] as const)(
    'says %s is temporary and when to retry',
    (code) => {
      renderPanel({
        result: null,
        error: analysisError(503, { error: 'x', code, retryAfterSeconds: 12 * 60 }),
      });
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Analysis is temporarily unavailable. Try again in 12 minutes.',
      );
    },
  );

  it('leaves out the retry time when the server gave none', () => {
    renderPanel({
      result: null,
      error: analysisError(503, { error: 'x', code: 'ANALYSIS_UNAVAILABLE' }),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/^Analysis is temporarily unavailable\.$/);
  });

  it.each([
    [502, 'ANALYSIS_FAILED'],
    [504, 'ANALYSIS_TIMEOUT'],
  ] as const)('offers Try again after a %i %s', async (status, code) => {
    const props = renderPanel({ result: null, error: analysisError(status, { error: 'x', code }) });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't generate an analysis. This didn't use one of your analyses.",
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('says an earlier request is still running', () => {
    renderPanel({
      result: null,
      error: analysisError(409, { error: 'x', code: 'ANALYSIS_IN_PROGRESS' }),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'An analysis you started is still running.',
    );
  });

  it('falls back to the server message for anything else', () => {
    renderPanel({
      result: null,
      error: new ApiError(404, { error: 'Unknown symbol: ZZZZ' }, '404 Not Found'),
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unknown symbol: ZZZZ');
    expect(within(alert.parentElement!).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows the error rather than a stale result', () => {
    renderPanel({ error: analysisError(502, { error: 'x', code: 'ANALYSIS_FAILED' }) });
    expect(screen.queryByText('BUY')).toBeNull();
  });
});

describe('confidenceWord', () => {
  it.each([
    [0, 'Low'],
    [39, 'Low'],
    [40, 'Moderate'],
    [69, 'Moderate'],
    [70, 'High'],
    [100, 'High'],
  ] as const)('%i → %s', (n, word) => {
    expect(confidenceWord(n)).toBe(word);
  });
});

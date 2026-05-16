import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import {
  SelectedSymbolProvider,
  useSelectedSymbol,
  useSetSelectedSymbol,
  useMaybeSetSelectedSymbol,
} from '@/contexts/SelectedSymbolContext';

function Reader() {
  const symbol = useSelectedSymbol();
  return <div data-testid="reader">{symbol ?? '(none)'}</div>;
}

function Writer({ next }: { next: string }) {
  const setSymbol = useSetSelectedSymbol();
  return (
    <button type="button" onClick={() => setSymbol(next)} data-testid="writer">
      set
    </button>
  );
}

describe('SelectedSymbolContext', () => {
  it('starts with no selected symbol by default', () => {
    render(
      <SelectedSymbolProvider>
        <Reader />
      </SelectedSymbolProvider>,
    );
    expect(screen.getByTestId('reader')).toHaveTextContent('(none)');
  });

  it('honors an `initial` prop on the provider', () => {
    render(
      <SelectedSymbolProvider initial="AAPL">
        <Reader />
      </SelectedSymbolProvider>,
    );
    expect(screen.getByTestId('reader')).toHaveTextContent('AAPL');
  });

  it('propagates writes from any consumer to every reader', async () => {
    const user = userEvent.setup();
    render(
      <SelectedSymbolProvider>
        <Reader />
        <Writer next="NVDA" />
      </SelectedSymbolProvider>,
    );
    expect(screen.getByTestId('reader')).toHaveTextContent('(none)');
    await user.click(screen.getByTestId('writer'));
    expect(screen.getByTestId('reader')).toHaveTextContent('NVDA');
  });

  it('uppercases the symbol on write', async () => {
    const user = userEvent.setup();
    render(
      <SelectedSymbolProvider>
        <Reader />
        <Writer next="aapl" />
      </SelectedSymbolProvider>,
    );
    await user.click(screen.getByTestId('writer'));
    expect(screen.getByTestId('reader')).toHaveTextContent('AAPL');
  });

  it('useSelectedSymbol throws when called outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Reader />)).toThrow(/SelectedSymbolProvider/i);
    spy.mockRestore();
  });

  it('useMaybeSetSelectedSymbol returns the setter inside the provider', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    function MaybeWriter() {
      const set = useMaybeSetSelectedSymbol();
      return (
        <button
          type="button"
          onClick={() => {
            onResult(set !== null);
            set?.('MSFT');
          }}
          data-testid="maybe-writer"
        >
          maybe-set
        </button>
      );
    }
    render(
      <SelectedSymbolProvider>
        <Reader />
        <MaybeWriter />
      </SelectedSymbolProvider>,
    );
    await user.click(screen.getByTestId('maybe-writer'));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('reader')).toHaveTextContent('MSFT');
  });

  it('useMaybeSetSelectedSymbol returns null outside the provider', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    function MaybeWriter() {
      const set = useMaybeSetSelectedSymbol();
      return (
        <button
          type="button"
          onClick={() => onResult(set !== null)}
          data-testid="maybe-writer"
        >
          maybe-set
        </button>
      );
    }
    render(<MaybeWriter />);
    await user.click(screen.getByTestId('maybe-writer'));
    expect(onResult).toHaveBeenCalledWith(false);
  });
});

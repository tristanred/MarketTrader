import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OhlcStrip } from '@/components/game/arena/OhlcStrip';

describe('OhlcStrip', () => {
  it('renders O / H / L / V values', () => {
    render(<OhlcStrip open={188.2} high={190.12} low={187.85} volume={42_300_000} />);
    expect(screen.getByText('O')).toBeInTheDocument();
    expect(screen.getByText('188.20')).toBeInTheDocument();
    expect(screen.getByText('190.12')).toBeInTheDocument();
    expect(screen.getByText('187.85')).toBeInTheDocument();
    expect(screen.getByText('42.30M')).toBeInTheDocument();
  });

  it('renders dashes when values are undefined', () => {
    render(<OhlcStrip />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';

describe('Panel primitives', () => {
  it('Panel renders children inside a bordered container', () => {
    render(
      <Panel data-testid="panel">
        <span>contents</span>
      </Panel>,
    );
    const el = screen.getByTestId('panel');
    expect(el).toHaveTextContent('contents');
    expect(el.className).toMatch(/rounded-panel/);
    expect(el.className).toMatch(/border/);
  });

  it('Panel merges custom className', () => {
    render(<Panel data-testid="panel" className="custom-x" />);
    expect(screen.getByTestId('panel').className).toMatch(/custom-x/);
  });

  it('Panel forwards arbitrary HTML props', () => {
    render(<Panel data-testid="panel" aria-label="my panel" />);
    expect(screen.getByTestId('panel')).toHaveAttribute('aria-label', 'my panel');
  });

  it('PanelHeader renders the label in uppercase mono small-caps style', () => {
    render(<PanelHeader>leaderboard</PanelHeader>);
    const header = screen.getByText('leaderboard');
    expect(header.className).toMatch(/font-mono/);
    expect(header.className).toMatch(/uppercase/);
    expect(header.className).toMatch(/tracking-/);
  });

  it('PanelHeader renders a right-slot when provided', () => {
    render(
      <PanelHeader right={<span data-testid="slot">LIVE</span>}>
        leaderboard
      </PanelHeader>,
    );
    expect(screen.getByTestId('slot')).toHaveTextContent('LIVE');
  });

  it('PanelBody applies padding and renders children', () => {
    render(
      <PanelBody data-testid="body">
        <span>row</span>
      </PanelBody>,
    );
    const body = screen.getByTestId('body');
    expect(body).toHaveTextContent('row');
    expect(body.className).toMatch(/p[xy]?-/);
  });

  it('Composes Panel + PanelHeader + PanelBody as the canonical module', () => {
    render(
      <Panel>
        <PanelHeader right={<span>LIVE</span>}>leaderboard</PanelHeader>
        <PanelBody>
          <div>row 1</div>
          <div>row 2</div>
        </PanelBody>
      </Panel>,
    );
    expect(screen.getByText('leaderboard')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('row 1')).toBeInTheDocument();
    expect(screen.getByText('row 2')).toBeInTheDocument();
  });
});

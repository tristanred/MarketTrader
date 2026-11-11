import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { JoinByCodeDialog } from '@/components/JoinByCodeDialog';

function JoinTarget() {
  const { code } = useParams();
  return <p>join page for {code}</p>;
}

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<JoinByCodeDialog open onOpenChange={onOpenChange} />} />
        <Route path="/join/:code" element={<JoinTarget />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onOpenChange };
}

describe('JoinByCodeDialog', () => {
  it('focuses the code field so a paste lands straight in it', () => {
    renderDialog();
    expect(screen.getByLabelText(/invite code/i)).toHaveFocus();
  });

  it('sends a typed code to the invite page, cleaned up', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText(/invite code/i), 'k7qm 4xtp');
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('join page for K7QM4XTP')).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('accepts a pasted invite link', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByLabelText(/invite code/i));
    await user.paste('https://markettrader.example/join/K7QM4XTP');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('join page for K7QM4XTP')).toBeInTheDocument();
  });

  it('keeps the dialog open and explains when the input cannot be a code', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    const field = screen.getByLabelText(/invite code/i);
    await user.type(field, 'not a code!');
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/doesn't look like an invite code/i)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clears the complaint once the viewer edits the code', async () => {
    const user = userEvent.setup();
    renderDialog();
    const field = screen.getByLabelText(/invite code/i);
    await user.type(field, '!');
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.type(field, '{Backspace}');
    expect(screen.queryByText(/doesn't look like an invite code/i)).not.toBeInTheDocument();
  });

  it('disables Next until something is entered', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});

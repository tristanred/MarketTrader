import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

describe('DialogContent', () => {
  // jsdom has no layout, so this pins the classes that keep a tall dialog
  // inside the viewport: Radix locks page scroll, so a dialog taller than the
  // window has no other way to reach its top and bottom.
  it('is capped to the viewport height and scrolls its own content', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Tall</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]');
    expect(dialog).toHaveClass('overflow-y-auto');
  });
});

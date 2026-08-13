import { test, expect } from '../fixtures/base';

const PHONE = { width: 375, height: 812 };

// 320 is the narrowest phone still worth supporting; 1024 is the first width
// at which the arena switches to its three-column grid and the centre column
// gets squeezed between the two fixed rails.
const WIDTHS = [320, 375, 414, 768, 1024, 1280];

/**
 * Serialises every element whose right edge lands past the viewport, so a
 * failure names the panel that widened the document instead of just reporting
 * a number. Elements under a clipping ancestor are skipped — the ticker tape
 * deliberately overflows inside `overflow-hidden` and cannot widen the
 * document, so reporting it would bury the real offender.
 */
const OVERFLOW_PROBE = `(() => {
  const limit = document.documentElement.clientWidth;
  const isClipped = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= limit + 1) continue;
    if (isClipped(el)) continue;
    const panel = el.closest('section, aside, [class*="rounded-panel"]');
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      text: (el.textContent || '').trim().slice(0, 60),
      panel: panel ? (panel.textContent || '').trim().slice(0, 40) : null,
      right: Math.round(r.right),
      width: Math.round(r.width),
    });
  }
  return out.sort((a, b) => b.right - a.right).slice(0, 12);
})()`;

test.describe('Arena layout across viewport widths', () => {
  test('the arena page never scrolls horizontally', async ({
    pageAs,
    playerUser,
    makeGame,
    apiClient,
  }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });

    const page = await pageAs(playerUser);
    await page.setViewportSize(PHONE);
    await page.goto(`/games/${game.id}`);
    await expect(page.getByText(game.name).first()).toBeVisible();
    // Leaderboard rows carry the widest grid; wait for the viewer's own row so
    // the assertion measures the populated layout rather than the empty state.
    await expect(page.locator('[data-current-user="true"]').first()).toBeVisible();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 812 });
      await expect
        .poll(
          async () => {
            const { scrollWidth, clientWidth } = await page.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
            }));
            return scrollWidth - clientWidth;
          },
          {
            message: `document scrolls horizontally at ${width}px. Offenders:\n${JSON.stringify(
              await page.evaluate(OVERFLOW_PROBE),
              null,
              2,
            )}`,
          },
        )
        .toBeLessThanOrEqual(0);
    }
  });

  test('the leaderboard drops its widest columns instead of overflowing', async ({
    pageAs,
    playerUser,
    makeGame,
    apiClient,
  }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });

    const page = await pageAs(playerUser);
    await page.setViewportSize(PHONE);
    await page.goto(`/games/${game.id}`);
    await expect(page.locator('[data-current-user="true"]').first()).toBeVisible();

    const trend = page.getByText('Trend', { exact: true });
    const delta = page.getByText('Δ24h', { exact: true });

    // Phone: both the sparkline and Δ24h are dropped so the money columns fit.
    await expect(trend).toBeHidden();
    await expect(delta).toBeHidden();

    // Tablet: Δ24h returns, sparkline still dropped.
    await page.setViewportSize({ width: 768, height: 812 });
    await expect(delta).toBeVisible();
    await expect(trend).toBeHidden();

    // Desktop: the full row, sparkline included.
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(trend).toBeVisible();
    await expect(delta).toBeVisible();
  });

  test('a dialog opened from the arena fits the viewport', async ({
    pageAs,
    playerUser,
    makeGame,
    apiClient,
  }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });

    const page = await pageAs(playerUser);
    await page.setViewportSize(PHONE);
    await page.goto(`/games/${game.id}`);
    await expect(page.getByText(game.name).first()).toBeVisible();
    // Open the dialog only once the arena is fully populated, so this also
    // covers the case where the page itself is wider than the viewport.
    await expect(page.locator('[data-current-user="true"]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Game info' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
  });
});

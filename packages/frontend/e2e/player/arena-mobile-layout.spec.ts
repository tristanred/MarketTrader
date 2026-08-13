import { test, expect } from '../fixtures/base';

const PHONE = { width: 375, height: 812 };

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
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
      right: Math.round(r.right),
      width: Math.round(r.width),
    });
  }
  return out.sort((a, b) => b.right - a.right).slice(0, 12);
})()`;

test.describe('Arena layout on a phone viewport', () => {
  test('the arena page does not scroll horizontally at 375px', async ({
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

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    const offenders = await page.evaluate(OVERFLOW_PROBE);
    expect(
      scrollWidth,
      `document scrolls horizontally (${scrollWidth} > ${clientWidth}). Offenders:\n${JSON.stringify(offenders, null, 2)}`,
    ).toBeLessThanOrEqual(clientWidth);
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
    // Open the dialog only once the arena is fully populated — the reported
    // knock-on effect depends on the document already being over-wide.
    await expect(page.locator('[data-current-user="true"]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Game info' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
  });
});

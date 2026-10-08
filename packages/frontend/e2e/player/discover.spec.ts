import { test, expect } from '../fixtures/base';

/**
 * E2E: a player reaches Discover from the top nav, sees the daily picks the
 * background worker generated, and opens a trade from one of them. The e2e
 * server runs the worker on a 1s tick (playwright.config.ts), so a new game's
 * list arrives within the page's first poll or two.
 */
test('header link → Discover picks → quote → trade dialog', async ({
  makeGame,
  joinedPlayer,
  pageAs,
}) => {
  const game = await makeGame({ name: `E2E_DISCOVER_${Date.now()}` });
  const player = await joinedPlayer(game.id);
  const page = await pageAs(player);

  await page.goto(`/games/${game.id}`);
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/games/${game.id}/discover$`));
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();

  // Until the worker's tick lands the page shows "being prepared"; it polls on its own,
  // but a reload makes the wait independent of the 60s poll interval.
  const tiles = page.getByRole('button', { name: /Open quote\.$/ });
  await expect(async () => {
    await page.reload();
    await expect(tiles.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(tiles).toHaveCount(20);
  await expect(page.getByRole('list', { name: 'Top gainers' })).toBeVisible();

  const symbol = (await tiles.first().getAttribute('aria-label'))?.split(',')[0] ?? '';
  await tiles.first().click();
  const quote = page.getByRole('dialog', { name: /quote information/i });
  await expect(quote).toBeVisible();
  await quote.getByRole('button', { name: new RegExp(`^Trade ${symbol}`) }).click();

  const trade = page.getByRole('dialog', { name: /trade order/i });
  await expect(trade).toBeVisible();
  await expect(
    trade.getByRole('button', { name: new RegExp(`^Buy \\d+ ${symbol}$`) }),
  ).toBeVisible();
});

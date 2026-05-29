import { test, expect, uniqueName } from './fixtures/base';
import { priceOf } from './fixtures/mock-prices';

/**
 * End-to-end happy path with deterministic mock prices:
 * 1. Register a new user via the UI
 * 2. Create + join a game (via the API — the UI's CreateGameDialog uses
 *    datetime-local inputs whose timezone handling is brittle in CI and
 *    occasionally produces "pending" games. The dialog is exercised by
 *    `player/games.spec.ts`; here we focus on the post-trade UI render.)
 * 3. Place a buy for 1 AAPL via API
 * 4. Navigate to the game arena
 * 5. Assert the AAPL holding renders in the HoldingsPanel
 * 6. Assert the PortfolioPanel cash stat reflects $100,000 − priceOf('AAPL').
 */
test('happy path: register → create game → buy AAPL → portfolio reflects holding and cash', async ({
  page,
  apiClient,
  loginAs,
  makeGame,
  adminUser,
}) => {
  // Materialize the worker-scoped admin first so the user we register through
  // the UI doesn't get promoted to admin as the first registered user.
  void adminUser;

  const username = uniqueName('e2e');
  const password = 'correct-horse-battery';

  // 1. Register through the UI — proves the auth round-trip.
  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(
    page.getByRole('heading', { name: /your games/i }),
  ).toBeVisible();

  // 2. Create the game via API (admin-owned, active immediately) and join as
  // the freshly-registered player. Acquire that player's access token via the
  // REST login endpoint so we can drive subsequent API calls on their behalf.
  const game = await makeGame({ name: `E2E_${Date.now()}` });
  const session = await loginAs({ username, password });
  const join = await apiClient.post(`/games/${game.id}/join`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  expect(join.ok(), `join failed: ${join.status()} ${await join.text()}`).toBeTruthy();

  // 3. Buy 1 AAPL via API.
  const buy = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
  });
  expect(
    buy.ok(),
    `buy failed: ${buy.status()} ${await buy.text()}`,
  ).toBeTruthy();

  // 4. Navigate to the game arena via the UI.
  await page.goto(`/games/${game.id}`);

  // 5. AAPL row appears in the HoldingsPanel table.
  await expect(
    page.locator('table').getByText('AAPL').first(),
  ).toBeVisible({ timeout: 15_000 });

  // 6. PortfolioPanel renders the deterministic post-trade cash:
  // $100,000 − $180 (AAPL mock price) = $99,820.
  const expectedCash = 100_000 - priceOf('AAPL');
  expect(expectedCash).toBe(99_820);
  const cashText = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(expectedCash);
  await expect(page.getByText(cashText).first()).toBeVisible({
    timeout: 15_000,
  });
});

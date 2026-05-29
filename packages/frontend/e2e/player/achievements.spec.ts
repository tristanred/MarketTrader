import { test, expect, uniqueName } from '../fixtures/base';

/**
 * E2E: placing the first trade unlocks the 'first-trade' achievement and
 * displays the unlock toast in the trader's UI. Verifies the full path:
 * server-side engine detects the unlock → broadcasts WS frame → frontend
 * filters peer unlocks → enqueues into toast store → host renders.
 */
test('first-trade unlock shows toast for the trader', async ({
  page,
  apiClient,
  loginAs,
  makeGame,
  adminUser,
}) => {
  // Materialize the worker-scoped admin first so the user we register
  // through the UI doesn't get promoted to admin.
  void adminUser;

  const username = uniqueName('e2e_ach');
  const password = 'correct-horse-battery';

  // Register via the UI (proves auth round-trip).
  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();

  // Create + join via API.
  const game = await makeGame({ name: `E2E_ACH_${Date.now()}` });
  const session = await loginAs({ username, password });
  const join = await apiClient.post(`/games/${game.id}/join`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  expect(join.ok(), `join failed: ${join.status()} ${await join.text()}`).toBeTruthy();

  // Navigate to the game arena — this opens the WS connection so the
  // achievement unlock broadcast will be received while the page is live.
  await page.goto(`/games/${game.id}`);
  await expect(page.getByText(/holdings|portfolio/i).first()).toBeVisible({ timeout: 15_000 });

  // Place the first trade via API — triggers the trade.executed event,
  // which the achievement engine catches and unlocks 'first-trade'.
  const buy = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
  });
  expect(buy.ok(), `buy failed: ${buy.status()} ${await buy.text()}`).toBeTruthy();

  // The toast should appear via the WS achievement.unlocked event arriving
  // on the open connection. 'First Trade' is the achievement name from the
  // committed definition (packages/server/src/achievements/definitions/first-trade.ts).
  // Use exact:true so the locator matches only the name element (not the
  // parent toast container, which also contains the text as a substring).
  await expect(page.getByText('First Trade', { exact: true })).toBeVisible({ timeout: 8_000 });

  // The eyebrow uses uppercase rarity. first-trade is 'common', so the
  // eyebrow renders as 'COMMON · UNLOCKED' for a live (non-replayed) unlock.
  await expect(page.getByText(/COMMON · UNLOCKED/)).toBeVisible();
});

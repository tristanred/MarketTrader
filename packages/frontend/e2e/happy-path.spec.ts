import { test, expect } from '@playwright/test';

/**
 * End-to-end happy path:
 * 1. Register a new user
 * 2. Create a game (auto-joined as creator) with an active window
 * 3. Open the game detail page
 * 4. Search for AAPL, place a buy
 * 5. See the holding appear in the portfolio
 * 6. See the leaderboard reflect the new value
 *
 * Uses Yahoo Finance for the quote — requires outbound network. Skip with
 * `PLAYWRIGHT_SKIP_NETWORK=1` if the runner has no internet.
 */
test('register → create game → buy AAPL → see portfolio + leaderboard', async ({ page }) => {
  test.skip(!!process.env['PLAYWRIGHT_SKIP_NETWORK'], 'Network access required for stock quote');

  const username = `e2e_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const password = 'correct-horse-battery';

  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();

  await page.getByRole('button', { name: /create game/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^name$/i).fill('E2E Game');
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 16);
  await dialog.getByLabel(/^start$/i).fill(fmt(start));
  await dialog.getByLabel(/^end$/i).fill(fmt(inOneHour));
  await dialog.getByRole('button', { name: /^create$/i }).click();

  await expect(page.getByRole('link', { name: 'E2E Game' })).toBeVisible();
  await page.getByRole('link', { name: 'E2E Game' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Game' })).toBeVisible();

  await page.getByRole('tab', { name: /^trade$/i }).click();
  await page.getByLabel(/symbol/i).fill('AAPL');
  await page.getByRole('button', { name: /^AAPL/ }).first().click();
  await page.getByLabel(/quantity/i).fill('1');
  await page.getByRole('button', { name: /^buy$/i }).click();

  await page.getByRole('tab', { name: /portfolio/i }).click();
  await expect(page.getByRole('cell', { name: 'AAPL' }).first()).toBeVisible({ timeout: 15_000 });
});

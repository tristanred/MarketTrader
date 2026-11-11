import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures/base';

/** Joins `gameId`, opens its arena and selects AAPL so the quote strip has its trade buttons. */
async function openArenaOnAapl(
  page: Page,
  apiClient: APIRequestContext,
  accessToken: string,
  gameId: string,
) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const list = await (
    await apiClient.post('/watchlists', { headers, data: { name: `arena_${Date.now()}` } })
  ).json();
  await apiClient.post(`/watchlists/${list.id}/items`, { headers, data: { symbol: 'AAPL' } });
  const join = await apiClient.post(`/games/${gameId}/join`, { headers });
  expect(join.ok(), `join: ${await join.text()}`).toBeTruthy();

  await page.goto(`/games/${gameId}`);
  await page.getByRole('button', { name: 'Select AAPL' }).click();
}

function inFromNow(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

const HOUR_MS = 60 * 60 * 1000;

test.describe('Player games', () => {
  test('create a game via the UI dialog', async ({ playerPage, adminUser }) => {
    // Touch adminUser so the worker-scoped admin is created first; otherwise
    // a fresh UI-registered user would become the admin.
    void adminUser;
    await playerPage.goto('/games');
    // The new-game action lives behind the games list's overflow menu.
    await playerPage.getByRole('button', { name: /games menu/i }).click();
    await playerPage.getByRole('menuitem', { name: /new game/i }).click();
    const dialog = playerPage.getByRole('dialog');
    const name = `g_${Date.now()}`;
    await dialog.getByLabel(/^name$/i).fill(name);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 16);
    await dialog.getByLabel(/^start$/i).fill(fmt(new Date(now.getTime() - 60_000)));
    await dialog.getByLabel(/^end$/i).fill(fmt(new Date(now.getTime() + 60 * 60 * 1000)));
    await dialog.getByRole('button', { name: /^create$/i }).click();
    await expect(playerPage.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  });

  test('joins a private game by pasting its invite code', async ({
    playerPage,
    apiClient,
    adminUser,
  }) => {
    const adminHeaders = { Authorization: `Bearer ${adminUser.accessToken}` };
    const name = `private_${Date.now()}`;
    const created = await apiClient.post('/games', {
      headers: adminHeaders,
      data: {
        name,
        startDate: inFromNow(-HOUR_MS),
        endDate: inFromNow(HOUR_MS),
        startingBalance: 100_000,
        visibility: 'private',
      },
    });
    expect(created.ok(), `create: ${await created.text()}`).toBeTruthy();
    const game = (await created.json()) as { id: string };
    const invite = await apiClient.post(`/games/${game.id}/invite-code`, { headers: adminHeaders });
    const { inviteCode } = (await invite.json()) as { inviteCode: string };

    await playerPage.goto('/games');
    await playerPage.getByRole('button', { name: /games menu/i }).click();
    await playerPage.getByRole('menuitem', { name: /join with code/i }).click();
    // Lowercase with a space, the way it gets read out or retyped.
    const quoted = `${inviteCode.slice(0, 4)} ${inviteCode.slice(4)}`.toLowerCase();
    await playerPage.getByLabel(/invite code/i).fill(quoted);
    await playerPage.getByRole('button', { name: /^next$/i }).click();

    await expect(playerPage).toHaveURL(new RegExp(`/join/${inviteCode}$`));
    await expect(playerPage.getByRole('heading', { name })).toBeVisible();
    await playerPage.getByRole('button', { name: /^join game$/i }).click();
    await expect(playerPage).toHaveURL(new RegExp(`/games/${game.id}$`));
  });

  test('opens game detail page from the deep link', async ({ playerPage, makeGame, apiClient, playerUser }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    await playerPage.goto(`/games/${game.id}`);
    // The player arena renders the game name in the StatusStrip ("DAY n/N · <name>"),
    // not in a dedicated heading. Match the visible text instead.
    await expect(playerPage.getByText(game.name).first()).toBeVisible();
  });

  test('GET /games lists games the player joined', async ({ apiClient, playerUser, makeGame }) => {
    const game = await makeGame();
    const join = await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(join.ok()).toBeTruthy();

    const list = await apiClient.get('/games', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const body = await list.json();
    const names = (body.games ?? body).map((g: { name: string }) => g.name);
    expect(names).toContain(game.name);
  });

  test('GET /public/featured-games is reachable unauthenticated', async ({ apiClient }) => {
    const res = await apiClient.get('/public/featured-games');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.games ?? body)).toBe(true);
  });
});

test.describe('Game page before the start', () => {
  const banner = (page: Page) => page.getByRole('region', { name: 'Game start' });
  const buy = (page: Page) => page.getByRole('button', { name: 'BUY', exact: true });
  const sell = (page: Page) => page.getByRole('button', { name: 'SELL', exact: true });

  test('shows when the game starts, with a running countdown', async ({
    playerPage,
    makeGame,
    apiClient,
    playerUser,
  }) => {
    const game = await makeGame({ startDate: inFromNow(HOUR_MS), endDate: inFromNow(2 * HOUR_MS) });
    await openArenaOnAapl(playerPage, apiClient, playerUser.accessToken, game.id);

    await expect(banner(playerPage)).toContainText(/\d{2}:\d{2}:\d{2}/);
    const first = await banner(playerPage).textContent();
    await expect.poll(() => banner(playerPage).textContent()).not.toBe(first);
  });

  test('does not claim a day count', async ({ playerPage, makeGame, apiClient, playerUser }) => {
    const game = await makeGame({ startDate: inFromNow(HOUR_MS), endDate: inFromNow(2 * HOUR_MS) });
    await openArenaOnAapl(playerPage, apiClient, playerUser.accessToken, game.id);

    await expect(playerPage.getByText(`NOT STARTED · ${game.name}`)).toBeVisible();
    await expect(playerPage.getByText(/DAY \d+ \/ \d+/)).toHaveCount(0);
  });

  test('disables BUY and SELL', async ({ playerPage, makeGame, apiClient, playerUser }) => {
    const game = await makeGame({ startDate: inFromNow(HOUR_MS), endDate: inFromNow(2 * HOUR_MS) });
    await openArenaOnAapl(playerPage, apiClient, playerUser.accessToken, game.id);

    await expect(buy(playerPage)).toBeDisabled();
    await expect(sell(playerPage)).toBeDisabled();
  });

  test('keeps the quote window open for research, without its Trade button', async ({
    playerPage,
    makeGame,
    apiClient,
    playerUser,
  }) => {
    const game = await makeGame({ startDate: inFromNow(HOUR_MS), endDate: inFromNow(2 * HOUR_MS) });
    await openArenaOnAapl(playerPage, apiClient, playerUser.accessToken, game.id);

    await playerPage.getByRole('button', { name: 'AAPL details' }).click();
    const dialog = playerPage.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: /View AAPL on TradingView/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Trade AAPL/ })).toHaveCount(0);
  });

  test('unlocks by itself when the start time passes', async ({
    playerPage,
    makeGame,
    apiClient,
    playerUser,
  }) => {
    test.setTimeout(45_000);
    const game = await makeGame({ startDate: inFromNow(10_000), endDate: inFromNow(HOUR_MS) });
    await openArenaOnAapl(playerPage, apiClient, playerUser.accessToken, game.id);

    await expect(buy(playerPage)).toBeDisabled();
    await expect(buy(playerPage)).toBeEnabled({ timeout: 25_000 });
    await expect(banner(playerPage)).toHaveCount(0);
    await expect(playerPage.getByText(`DAY 1 / 1 · ${game.name}`)).toBeVisible();

    await buy(playerPage).click();
    await playerPage.getByRole('dialog').getByRole('button', { name: 'Buy 1 AAPL' }).click();
    await expect(playerPage.getByText('Bought 1 AAPL')).toBeVisible();
  });

  test('a running game has no banner and can trade', async ({
    playerPage,
    makeGame,
    apiClient,
    playerUser,
  }) => {
    const game = await makeGame();
    await openArenaOnAapl(playerPage, apiClient, playerUser.accessToken, game.id);

    await expect(buy(playerPage)).toBeEnabled();
    await expect(sell(playerPage)).toBeEnabled();
    await expect(banner(playerPage)).toHaveCount(0);

    await playerPage.getByRole('button', { name: 'AAPL details' }).click();
    await expect(
      playerPage.getByRole('dialog').getByRole('button', { name: /^Trade AAPL/ }),
    ).toBeVisible();
  });
});

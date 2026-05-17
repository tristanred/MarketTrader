import { test, expect } from '../fixtures/base';

test.describe('Player games', () => {
  test('create a game via the UI dialog', async ({ playerPage, adminUser }) => {
    // Touch adminUser so the worker-scoped admin is created first; otherwise
    // a fresh UI-registered user would become the admin.
    void adminUser;
    await playerPage.goto('/games');
    await playerPage.getByRole('button', { name: /new game/i }).click();
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

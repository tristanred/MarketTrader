import { test, expect } from '../fixtures/base';

test.describe('Watchlists', () => {
  test('API: create → patch → list → delete', async ({ apiClient, playerUser }) => {
    const auth = { Authorization: `Bearer ${playerUser.accessToken}` };
    const create = await apiClient.post('/watchlists', {
      headers: auth,
      data: { name: 'Faves' },
    });
    expect(create.ok(), `create: ${await create.text()}`).toBeTruthy();
    const wl = await create.json();

    const patch = await apiClient.patch(`/watchlists/${wl.id}`, {
      headers: auth,
      data: { name: 'My Faves' },
    });
    expect(patch.ok(), `patch: ${await patch.text()}`).toBeTruthy();

    const list = await apiClient.get('/watchlists', { headers: auth });
    expect(JSON.stringify(await list.json())).toContain('My Faves');

    const del = await apiClient.delete(`/watchlists/${wl.id}`, { headers: auth });
    expect(del.ok()).toBeTruthy();
  });

  test('API: add then remove symbol', async ({ apiClient, playerUser }) => {
    const auth = { Authorization: `Bearer ${playerUser.accessToken}` };
    const wl = await (
      await apiClient.post('/watchlists', { headers: auth, data: { name: 'tmp' } })
    ).json();

    const add = await apiClient.post(`/watchlists/${wl.id}/items`, {
      headers: auth,
      data: { symbol: 'NVDA' },
    });
    expect(add.ok(), `add: ${await add.text()}`).toBeTruthy();

    expect(
      JSON.stringify(await (await apiClient.get('/watchlists', { headers: auth })).json()),
    ).toContain('NVDA');

    const rm = await apiClient.delete(`/watchlists/${wl.id}/items/NVDA`, {
      headers: auth,
    });
    expect(rm.ok(), `remove: ${await rm.text()}`).toBeTruthy();
  });

  test('UI: watchlist panel renders symbols', async ({
    playerPage,
    apiClient,
    playerUser,
    makeGame,
  }) => {
    const auth = { Authorization: `Bearer ${playerUser.accessToken}` };
    const wl = await (
      await apiClient.post('/watchlists', { headers: auth, data: { name: 'UIList' } })
    ).json();
    await apiClient.post(`/watchlists/${wl.id}/items`, {
      headers: auth,
      data: { symbol: 'AAPL' },
    });

    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, { headers: auth });
    await playerPage.goto(`/games/${game.id}`);

    await expect(playerPage.getByText('AAPL').first()).toBeVisible({ timeout: 10_000 });
  });
});

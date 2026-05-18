import { test, expect } from '../fixtures/base';

test.describe('Admin portfolios', () => {
  test('API: view, patch cash, add/remove holding, wipe', async ({
    apiClient,
    adminUser,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const playersRes = await apiClient.get(`/admin/games/${game.id}/players`, { headers: auth });
    expect(playersRes.ok(), `players: ${playersRes.status()} ${await playersRes.text()}`).toBeTruthy();
    const playersBody = await playersRes.json();
    const players = playersBody.players ?? playersBody;
    const row = players.find((p: { userId: string }) => p.userId === player.userId);
    expect(row, 'player row not found').toBeDefined();
    const playerId = row.playerId ?? row.id ?? row.userId;

    const view = await apiClient.get(`/admin/players/${playerId}/portfolio`, { headers: auth });
    expect(view.ok(), `view: ${view.status()} ${await view.text()}`).toBeTruthy();

    const cash = await apiClient.patch(`/admin/players/${playerId}/cash`, {
      headers: auth,
      data: { cashBalance: 50_000 },
    });
    expect(cash.ok(), `cash: ${cash.status()} ${await cash.text()}`).toBeTruthy();

    // Add a new holding: positive quantityDelta requires costBasis when creating.
    const add = await apiClient.post(`/admin/players/${playerId}/holdings`, {
      headers: auth,
      data: { symbol: 'AAPL', quantityDelta: 5, costBasis: 100 },
    });
    expect(add.ok(), `add: ${add.status()} ${await add.text()}`).toBeTruthy();

    // Remove the same shares via a negative delta on the same holding.
    const remove = await apiClient.post(`/admin/players/${playerId}/holdings`, {
      headers: auth,
      data: { symbol: 'AAPL', quantityDelta: -5 },
    });
    expect(remove.ok(), `remove: ${remove.status()} ${await remove.text()}`).toBeTruthy();

    // DELETE wipes every holding (no body) — exercise the route too.
    const wipe = await apiClient.delete(`/admin/players/${playerId}/holdings`, { headers: auth });
    expect(wipe.ok(), `wipe: ${wipe.status()} ${await wipe.text()}`).toBeTruthy();
  });

  test('UI: admin portfolios page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/portfolios');
    await expect(adminPage.getByRole('heading', { name: /portfolios/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

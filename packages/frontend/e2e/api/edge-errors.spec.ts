import { test, expect } from '../fixtures/base';

test.describe.configure({ retries: 0 });

test('401 when missing Authorization', async ({ apiClient }) => {
  const res = await apiClient.get('/games');
  expect(res.status()).toBe(401);
});

test('403 when non-admin hits /admin/audit', async ({ apiClient, playerUser }) => {
  const res = await apiClient.get('/admin/audit', {
    headers: { Authorization: `Bearer ${playerUser.accessToken}` },
  });
  expect(res.status()).toBe(403);
});

test('404 on unknown game', async ({ apiClient, playerUser }) => {
  const res = await apiClient.get('/games/00000000-0000-0000-0000-000000000000', {
    headers: { Authorization: `Bearer ${playerUser.accessToken}` },
  });
  expect(res.status()).toBe(404);
});

test('409 GAME_NOT_ACTIVE on pending-status game trade', async ({
  apiClient,
  makeGame,
  joinedPlayer,
}) => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const farther = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const game = await makeGame({ startDate: future, endDate: farther });
  const player = await joinedPlayer(game.id);

  const res = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
  });
  expect(res.status()).toBe(409);
});

test('400 or 422 on zero-qty trade', async ({ apiClient, makeGame, joinedPlayer }) => {
  const game = await makeGame();
  const player = await joinedPlayer(game.id);
  const res = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', direction: 'buy', quantity: 0 },
  });
  expect([400, 422]).toContain(res.status());
});

test('400 or 422 on oversold position', async ({ apiClient, makeGame, joinedPlayer }) => {
  const game = await makeGame();
  const player = await joinedPlayer(game.id);
  await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
  });
  const res = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', direction: 'sell', quantity: 5 },
  });
  expect([400, 422]).toContain(res.status());
});

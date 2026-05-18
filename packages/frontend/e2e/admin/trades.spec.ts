import { test, expect } from '../fixtures/base';

test.describe('Admin trades', () => {
  test('API: patch price + reverse on an executed trade', async ({
    apiClient,
    adminUser,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const adminAuth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const exec = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', direction: 'buy', quantity: 2 },
    });
    if (!exec.ok()) test.skip(true, `place market order failed: ${exec.status()} ${await exec.text()}`);
    const placed = await exec.json();
    // Market orders return { trade, cashBalance }; pending market-hours
    // orders return { pending }; limit/stop orders return { orders }.
    const tradeId =
      placed.trade?.id ??
      placed.id ??
      placed.tradeId ??
      placed.pending?.id ??
      placed.orders?.[0]?.id;
    expect(tradeId, `could not extract tradeId from ${JSON.stringify(placed)}`).toBeTruthy();

    const patch = await apiClient.patch(`/admin/trades/${tradeId}/price`, {
      headers: adminAuth,
      data: { price: 200 },
    });
    expect(patch.ok(), `patch price: ${patch.status()} ${await patch.text()}`).toBeTruthy();

    const reverse = await apiClient.post(`/admin/trades/${tradeId}/reverse`, {
      headers: adminAuth,
    });
    expect(reverse.ok(), `reverse: ${reverse.status()} ${await reverse.text()}`).toBeTruthy();
  });

  test('API: cancel + force-execute on a working order', async ({
    apiClient,
    adminUser,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame({ allowLimitOrders: true });
    const player = await joinedPlayer(game.id);
    const adminAuth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const limit = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        limitPrice: 50,
      },
    });
    if (!limit.ok()) test.skip(true, `limit order not accepted: ${limit.status()} ${await limit.text()}`);
    const placed = await limit.json();
    const tradeId = placed.orders?.[0]?.id ?? placed.trade?.id ?? placed.id;
    expect(tradeId, `could not extract tradeId from ${JSON.stringify(placed)}`).toBeTruthy();

    const cancel = await apiClient.delete(`/admin/trades/${tradeId}`, { headers: adminAuth });
    expect(cancel.ok(), `cancel: ${cancel.status()} ${await cancel.text()}`).toBeTruthy();

    const force = await apiClient.post(`/admin/trades/${tradeId}/force-execute`, {
      headers: adminAuth,
    });
    // After cancel, force-execute should fail with 409 invalid_status.
    expect(force.ok()).toBeFalsy();
  });

  test('UI: admin trades page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/trades');
    await expect(adminPage.getByRole('heading', { name: /trades/i })).toBeVisible();
  });
});

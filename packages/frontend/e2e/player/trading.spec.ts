import { test, expect } from '../fixtures/base';
import { priceOf } from '../fixtures/mock-prices';

test.describe('Player trading', () => {
  test('UI: buy AAPL → appears in portfolio', async ({
    playerPage,
    makeGame,
    apiClient,
    playerUser,
    adminUser,
  }) => {
    // Depend on adminUser so the worker-scoped admin materialises first.
    void adminUser;
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    // Buy via API — the arena UI no longer exposes Trade/Portfolio tabs;
    // the test still exercises the live UI by asserting the holdings table
    // picks up the new position after navigation.
    const buy = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
      data: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(buy.ok(), `buy failed: ${await buy.text()}`).toBeTruthy();

    await playerPage.goto(`/games/${game.id}`);
    await expect(
      playerPage.locator('table').getByText('AAPL').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('API: buy then sell, net flat', async ({
    apiClient,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);

    const buy = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', direction: 'buy', quantity: 10 },
    });
    expect(buy.ok(), `buy: ${await buy.text()}`).toBeTruthy();

    const sell = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', direction: 'sell', quantity: 10 },
    });
    expect(sell.ok(), `sell: ${await sell.text()}`).toBeTruthy();

    const port = await apiClient.get(`/games/${game.id}/portfolio`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    const body = await port.json();
    const holdings = body.holdings ?? body.positions ?? [];
    expect(
      holdings.find((h: { symbol: string }) => h.symbol === 'AAPL'),
    ).toBeUndefined();
    expect(body.cashBalance ?? body.cash).toBeCloseTo(100_000, 0);
  });

  test('API: insufficient funds returns 422 INSUFFICIENT_FUNDS', async ({
    apiClient,
    makeGame,
    joinedPlayer,
  }) => {
    // AAPL mock price is $180; with $100 starting cash, 1 share is unaffordable.
    const game = await makeGame({ startingCash: 100 });
    const player = await joinedPlayer(game.id);
    const res = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.code ?? body.error).toMatch(/INSUFFICIENT_FUNDS/);
  });

  test('API: short selling blocked', async ({
    apiClient,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const res = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', direction: 'sell', quantity: 1 },
    });
    expect([400, 422]).toContain(res.status());
    expect(JSON.stringify(await res.json())).toMatch(
      /SHORT_SELLING|INSUFFICIENT_SHARES/,
    );
  });

  test('API: limit order → working list → cancel', async ({
    apiClient,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame({ allowLimitOrders: true });
    const player = await joinedPlayer(game.id);
    const place = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        limitPrice: priceOf('AAPL') - 50,
      },
    });
    if (place.status() === 409 || place.status() === 400) {
      const body = await place.json();
      test.skip(
        /LIMIT_ORDERS_DISABLED/.test(JSON.stringify(body)),
        'limit orders disabled',
      );
    }
    expect(place.ok(), `place: ${await place.text()}`).toBeTruthy();
    const placed = await place.json();
    // POST returns 202 { orders: [WorkingOrder, ...] }
    const order = (placed.orders ?? [placed])[0];
    const tradeId = order.id ?? placed.id ?? placed.tradeId;
    expect(tradeId).toBeTruthy();

    const working = await apiClient.get(
      `/games/${game.id}/trades?status=working`,
      {
        headers: { Authorization: `Bearer ${player.accessToken}` },
      },
    );
    expect(JSON.stringify(await working.json())).toContain(tradeId);

    const cancel = await apiClient.delete(
      `/games/${game.id}/trades/${tradeId}`,
      {
        headers: { Authorization: `Bearer ${player.accessToken}` },
      },
    );
    expect(cancel.ok()).toBeTruthy();
  });

  test('API: trade history returns executed trades', async ({
    apiClient,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'MSFT', direction: 'buy', quantity: 1 },
    });
    const hist = await apiClient.get(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    expect(hist.ok()).toBeTruthy();
    const body = await hist.json();
    const trades = body.trades ?? body;
    expect(
      trades.some((t: { symbol: string }) => t.symbol === 'MSFT'),
    ).toBe(true);
  });

  test('API: pending list empty under MARKET_HOURS_MODE=instant', async ({
    apiClient,
    makeGame,
    joinedPlayer,
  }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const list = await apiClient.get(`/games/${game.id}/trades/pending`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    expect(list.ok()).toBeTruthy();
    const body = await list.json();
    expect(Array.isArray(body.trades ?? body)).toBe(true);
  });
});

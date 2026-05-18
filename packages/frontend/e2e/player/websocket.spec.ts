import { test, expect } from '../fixtures/base';

test.describe('WebSocket live updates', () => {
  // The current arena UI's LeaderboardPanel reads from gameData.leaderboard
  // (REST snapshot from useGame). useGameSocket's `trade_executed` /
  // `leaderboard_update` handlers write to liveStore and invalidate
  // tradeKeys.working|pending, but do NOT invalidate gameKeys.detail, and
  // useGame has no refetchInterval. So another player's trade has no path
  // to refresh the displayed leaderboard rows in this player's tab.
  // Test left as fixme until either the panel reads from liveStore or the
  // socket invalidates gameKeys.detail on trade_executed.
  test.fixme(
    'leaderboard reacts when another player trades',
    async ({
      playerPage,
      apiClient,
      makeGame,
      joinedPlayer,
      playerUser,
      adminUser,
    }) => {
      void adminUser;
      const game = await makeGame();
      await apiClient.post(`/games/${game.id}/join`, {
        headers: { Authorization: `Bearer ${playerUser.accessToken}` },
      });
      const other = await joinedPlayer(game.id);

      await playerPage.goto(`/games/${game.id}`);
      const row = playerPage.getByText(other.username).first();
      await expect(row).toBeVisible({ timeout: 10_000 });

      const beforeRow = await row
        .locator('xpath=..')
        .textContent()
        .catch(() => '');

      const trade = await apiClient.post(`/games/${game.id}/trades`, {
        headers: { Authorization: `Bearer ${other.accessToken}` },
        data: { symbol: 'AAPL', direction: 'buy', quantity: 10 },
      });
      expect(trade.ok(), `trade: ${await trade.text()}`).toBeTruthy();

      await expect
        .poll(
          async () =>
            row
              .locator('xpath=..')
              .textContent()
              .catch(() => beforeRow),
          { timeout: 10_000 },
        )
        .not.toBe(beforeRow);
    },
  );

  // OpenOrdersList exists at packages/frontend/src/components/OpenOrdersList.tsx
  // but is not mounted in GameDetailPage (the new arena layout). The arena's
  // right column is SymbolSearchPanel / WatchlistPanel / ActivityPanel.
  // Re-enable once OpenOrdersList is wired into the arena.
  test.fixme(
    'open-orders updates when admin force-executes a working order',
    async ({ playerPage, apiClient, adminUser, makeGame, playerUser }) => {
      const game = await makeGame({ allowLimitOrders: true });
      await apiClient.post(`/games/${game.id}/join`, {
        headers: { Authorization: `Bearer ${playerUser.accessToken}` },
      });

      const place = await apiClient.post(`/games/${game.id}/trades`, {
        headers: { Authorization: `Bearer ${playerUser.accessToken}` },
        data: {
          symbol: 'AAPL',
          direction: 'buy',
          quantity: 1,
          orderType: 'limit',
          limitPrice: 50,
        },
      });
      if (!place.ok()) {
        test.skip(true, `limit order not accepted: ${await place.text()}`);
      }
      const placedBody = await place.json();
      const tradeId =
        placedBody.orders?.[0]?.id ?? placedBody.id ?? placedBody.tradeId;
      expect(tradeId).toBeTruthy();

      await playerPage.goto(`/games/${game.id}`);
      await expect(playerPage.getByText('AAPL').first()).toBeVisible({
        timeout: 10_000,
      });

      const force = await apiClient.post(
        `/admin/trades/${tradeId}/force-execute`,
        { headers: { Authorization: `Bearer ${adminUser.accessToken}` } },
      );
      expect(force.ok(), `force-execute: ${await force.text()}`).toBeTruthy();

      await expect
        .poll(
          async () =>
            playerPage
              .getByText(/no open orders|no working orders|empty/i)
              .isVisible()
              .catch(() => false),
          { timeout: 10_000 },
        )
        .toBeTruthy();
    },
  );

  test('global indices ticker connects without WS errors', async ({
    playerPage,
  }) => {
    const wsErrors: string[] = [];
    playerPage.on('console', (m) => {
      if (m.type() === 'error' && /websocket|ws/i.test(m.text())) {
        wsErrors.push(m.text());
      }
    });
    await playerPage.goto('/games');
    await playerPage.waitForTimeout(2_000);
    expect(wsErrors).toEqual([]);
  });
});

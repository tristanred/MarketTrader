import { test, expect } from '../fixtures/base';

const GAMES_LIMIT = 'LIMIT_GAMES_CREATED_PER_WEEK';

test.describe('Admin limits', () => {
  let playerId: string | undefined;

  // Shared e2e DB and server: never leave limits switched on or an override
  // behind, even when a step fails, or every later spec inherits them.
  test.afterEach(async ({ apiClient, adminUser }) => {
    const headers = { Authorization: `Bearer ${adminUser.accessToken}` };
    await apiClient.delete('/admin/config/LIMITS_ENABLED', { headers });
    await apiClient.delete(`/admin/config/${GAMES_LIMIT}`, { headers });
    if (playerId) {
      await apiClient.delete(`/admin/users/${playerId}/limits/gamesCreated`, { headers });
      playerId = undefined;
    }
  });

  test('UI: a per-user override lets a capped player create another game', async ({
    apiClient,
    adminUser,
    adminPage,
    registerUser,
  }) => {
    const adminHeaders = { Authorization: `Bearer ${adminUser.accessToken}` };

    // Register BEFORE turning limits on: every e2e account comes from
    // 127.0.0.1, so with limits on this registration would already be past
    // LIMIT_REGISTRATIONS_PER_IP_PER_DAY.
    const player = await registerUser();
    playerId = player.userId;

    for (const [key, value] of [
      ['LIMITS_ENABLED', true],
      [GAMES_LIMIT, 1],
    ] as const) {
      const res = await apiClient.put(`/admin/config/${key}`, { headers: adminHeaders, data: { value } });
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    const createGame = (name: string) =>
      apiClient.post('/games', {
        headers: { Authorization: `Bearer ${player.accessToken}` },
        data: {
          name,
          startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          startingBalance: 100_000,
        },
      });

    // A fresh account is on probation, but 25% of 1 still rounds up to 1.
    expect((await createGame('limits-e2e-1')).status()).toBe(201);
    const denied = await createGame('limits-e2e-2');
    expect(denied.status()).toBe(429);
    expect(await denied.json()).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'gamesCreated', max: 1 });

    await adminPage.goto(`/admin/users/${player.userId}`);
    const row = adminPage.locator('[data-limit-key="gamesCreated"]');
    await expect(row.getByText('1 / 1')).toBeVisible();
    await row.getByRole('button', { name: /^Override / }).click();
    await row.getByLabel(/^Override value for /).fill('2');
    await row.getByLabel(/^Override note for /).fill('e2e colleague');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Override', { exact: true })).toBeVisible();
    await expect(row.getByText('e2e colleague')).toBeVisible();

    expect((await createGame('limits-e2e-3')).status()).toBe(201);

    await adminPage.goto('/admin/limits');
    const overridesTable = adminPage.getByRole('table', { name: 'Active overrides' });
    await expect(overridesTable.getByRole('link', { name: player.username })).toBeVisible();
  });
});

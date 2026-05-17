import { test, expect } from '../fixtures/base';

test.describe('Admin games', () => {
  test('API: list/detail/patch/status/reset/delete', async ({ apiClient, adminUser, makeGame }) => {
    const game = await makeGame();
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };

    expect((await apiClient.get('/admin/games', { headers: auth })).ok()).toBeTruthy();
    expect((await apiClient.get(`/admin/games/${game.id}`, { headers: auth })).ok()).toBeTruthy();

    const patch = await apiClient.patch(`/admin/games/${game.id}`, {
      headers: auth, data: { name: `renamed_${Date.now()}` },
    });
    expect(patch.ok(), `patch: ${patch.status()} ${await patch.text()}`).toBeTruthy();

    const status = await apiClient.post(`/admin/games/${game.id}/status`, {
      headers: auth, data: { status: 'ended' },
    });
    expect(status.ok(), `status: ${status.status()} ${await status.text()}`).toBeTruthy();

    const reset = await apiClient.post(`/admin/games/${game.id}/reset`, { headers: auth });
    expect(reset.ok(), `reset: ${reset.status()} ${await reset.text()}`).toBeTruthy();

    // Game creator is auto-enrolled, so delete needs ?force=true to cascade.
    const del = await apiClient.delete(`/admin/games/${game.id}?force=true`, { headers: auth });
    expect(del.ok(), `delete: ${del.status()} ${await del.text()}`).toBeTruthy();
  });

  test('API: add/remove players + list players + game trades', async ({ apiClient, adminUser, makeGame, registerUser }) => {
    const game = await makeGame();
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };
    const target = await registerUser();

    const add = await apiClient.post(`/admin/games/${game.id}/players`, {
      headers: auth, data: { userId: target.userId },
    });
    expect(add.ok(), `add: ${add.status()} ${await add.text()}`).toBeTruthy();

    const listRes = await apiClient.get(`/admin/games/${game.id}/players`, { headers: auth });
    expect(listRes.ok(), `list: ${listRes.status()} ${await listRes.text()}`).toBeTruthy();
    const listBody = await listRes.json();
    const players = listBody.players ?? listBody;
    const row = players.find((p: { userId: string }) => p.userId === target.userId);
    expect(row).toBeDefined();

    expect((await apiClient.get(`/admin/games/${game.id}/trades`, { headers: auth })).ok()).toBeTruthy();

    const rm = await apiClient.delete(
      `/admin/games/${game.id}/players/${row.playerId ?? row.id ?? row.userId}`,
      { headers: auth },
    );
    expect(rm.ok(), `remove: ${rm.status()} ${await rm.text()}`).toBeTruthy();
  });

  test('API: transfer owner', async ({ apiClient, adminUser, makeGame, registerUser }) => {
    const game = await makeGame();
    const newOwner = await registerUser();
    const res = await apiClient.patch(`/admin/games/${game.id}/owner`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { newOwnerId: newOwner.userId },
    });
    expect(res.ok(), `transfer: ${res.status()} ${await res.text()}`).toBeTruthy();
  });

  test('API: cancel all working orders', async ({ apiClient, adminUser, makeGame }) => {
    const game = await makeGame();
    const res = await apiClient.post(`/admin/games/${game.id}/cancel-working-orders`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok(), `cancel: ${res.status()} ${await res.text()}`).toBeTruthy();
  });

  test('UI: admin games page lists games', async ({ adminPage, makeGame }) => {
    const game = await makeGame();
    await adminPage.goto('/admin/games');
    await expect(adminPage.getByText(game.name).first()).toBeVisible({ timeout: 10_000 });
  });

  test('UI: admin game detail page', async ({ adminPage, makeGame }) => {
    const game = await makeGame();
    await adminPage.goto(`/admin/games/${game.id}`);
    await expect(adminPage.getByRole('heading', { name: game.name })).toBeVisible();
  });
});

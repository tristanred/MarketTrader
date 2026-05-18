import { test, expect } from '../fixtures/base';

test.describe('Admin users', () => {
  test('API: list users includes the player', async ({ apiClient, adminUser, playerUser }) => {
    const res = await apiClient.get('/admin/users', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    const body = await res.json();
    const users = body.users ?? body;
    expect(users.some((u: { username: string }) => u.username === playerUser.username)).toBe(true);
  });

  test('API: get user detail', async ({ apiClient, adminUser, playerUser }) => {
    const res = await apiClient.get(`/admin/users/${playerUser.userId}`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    const body = await res.json();
    expect(body.username).toBe(playerUser.username);
  });

  test('API: patch user username', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const newName = `renamed_${Date.now()}`;
    const res = await apiClient.patch(`/admin/users/${target.userId}`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { username: newName },
    });
    expect(res.ok(), `patch: ${await res.text()}`).toBeTruthy();
  });

  test('API: list user players', async ({ apiClient, adminUser, playerUser, makeGame }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const res = await apiClient.get(`/admin/users/${playerUser.userId}/players`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: reset password', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const res = await apiClient.post(`/admin/users/${target.userId}/reset-password`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { newPassword: 'reset-password-x' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: add then remove group membership', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const add = await apiClient.post(`/admin/users/${target.userId}/groups/admin`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(add.ok()).toBeTruthy();
    const remove = await apiClient.delete(`/admin/users/${target.userId}/groups/admin`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(remove.ok()).toBeTruthy();
  });

  test('API: delete user', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const res = await apiClient.delete(`/admin/users/${target.userId}`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('UI: admin users page lists the player', async ({ adminPage, playerUser }) => {
    await adminPage.goto('/admin/users');
    await expect(adminPage.getByText(playerUser.username).first()).toBeVisible({ timeout: 10_000 });
  });

  test('UI: admin user detail page renders', async ({ adminPage, playerUser }) => {
    await adminPage.goto(`/admin/users/${playerUser.userId}`);
    await expect(adminPage.getByText(playerUser.username).first()).toBeVisible({ timeout: 10_000 });
  });
});

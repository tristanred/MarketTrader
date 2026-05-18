import { test, expect } from '../fixtures/base';

test.describe('Admin audit', () => {
  test('API: audit log records admin actions', async ({ apiClient, adminUser, makeGame, registerUser }) => {
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };

    // Generate at least one auditable action
    const game = await makeGame();
    const target = await registerUser();
    await apiClient.post(`/admin/games/${game.id}/players`, {
      headers: auth, data: { userId: target.userId },
    });

    const res = await apiClient.get('/admin/audit?limit=20', { headers: auth });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const entries = body.entries ?? body;
    expect(entries.length).toBeGreaterThan(0);
  });

  test('UI: admin audit page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/audit');
    await expect(adminPage.getByRole('heading', { name: /audit/i })).toBeVisible();
  });
});

import { test, expect } from '../fixtures/base';

test.describe('Admin config', () => {
  // The e2e DB is shared by the whole run, so a failed step must not leave the
  // override behind. DELETE is idempotent: 200 even with no override row.
  test.afterEach(async ({ apiClient, adminUser }) => {
    await apiClient.delete('/admin/config/WATCHLIST_MAX_ITEMS', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
  });

  test('API: list, override, and reset a live option', async ({ apiClient, adminUser }) => {
    const headers = { Authorization: `Bearer ${adminUser.accessToken}` };

    const list = await apiClient.get('/admin/config', { headers });
    expect(list.ok()).toBeTruthy();
    const { entries } = (await list.json()) as { entries: { key: string; secret: boolean; bootValue: unknown }[] };
    expect(entries.some((e) => e.key === 'WATCHLIST_MAX_ITEMS')).toBeTruthy();
    expect(entries.filter((e) => e.secret).every((e) => e.bootValue === null)).toBeTruthy();

    const put = await apiClient.put('/admin/config/WATCHLIST_MAX_ITEMS', { headers, data: { value: 42 } });
    expect(put.ok(), await put.text()).toBeTruthy();
    expect((await put.json()).effectiveValue).toBe(42);

    const reset = await apiClient.delete('/admin/config/WATCHLIST_MAX_ITEMS', { headers });
    expect(reset.ok()).toBeTruthy();
    expect((await reset.json()).override).toBeNull();
  });

  test('UI: config page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/config');
    await expect(adminPage.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await expect(adminPage.getByText('WATCHLIST_MAX_ITEMS')).toBeVisible();
  });
});

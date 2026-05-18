import { test, expect } from '../fixtures/base';

test.describe('Admin system', () => {
  test('API: override stock price', async ({ apiClient, adminUser }) => {
    const res = await apiClient.patch('/admin/stocks/AAPL/price', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { price: 9999 },
    });
    expect(res.ok(), `price: ${await res.text()}`).toBeTruthy();
  });

  test('API: flush cache', async ({ apiClient, adminUser }) => {
    const res = await apiClient.post('/admin/stocks/cache/flush', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: stats endpoint', async ({ apiClient, adminUser }) => {
    const res = await apiClient.get('/admin/stats', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  test('API: update ticker-tape settings', async ({ apiClient, adminUser, playerUser }) => {
    const res = await apiClient.put('/admin/system-settings/ticker-tape', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { symbols: ['AAPL', 'MSFT'] },
    });
    expect(res.ok(), `ticker-tape: ${await res.text()}`).toBeTruthy();

    const fetched = await apiClient.get('/system-settings/ticker-tape', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(JSON.stringify(await fetched.json())).toContain('AAPL');
  });

  test('UI: admin system page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/system');
    await expect(adminPage.getByRole('heading', { name: /system/i })).toBeVisible();
  });
});

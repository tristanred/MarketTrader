import { test, expect } from '../fixtures/base';

test.describe('Market status', () => {
  test('API: returns a state string', async ({ apiClient }) => {
    const res = await apiClient.get('/market/status');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof (body.state ?? body.marketState)).toBe('string');
  });

  test('UI: status strip renders a market value', async ({ playerPage }) => {
    await playerPage.goto('/games');
    await expect(playerPage.getByText(/market/i).first()).toBeVisible();
  });

  test('API: GET /system-settings/ticker-tape reachable', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/system-settings/ticker-tape', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});

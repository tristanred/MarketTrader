import { test, expect } from '../fixtures/base';

// The e2e server has no LLM configured, so this covers the off state end to end;
// generation, caching, quotas and errors are covered by the server and component suites.
test.describe('Stock analysis (not configured)', () => {
  test('API: status reports the feature off', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL/analysis/status', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toMatchObject({ enabled: false, available: false, cached: false });
  });

  test('API: analyze answers 503 ANALYSIS_DISABLED', async ({ apiClient, playerUser }) => {
    const res = await apiClient.post('/stocks/AAPL/analysis', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.status()).toBe(503);
    expect((await res.json()).code).toBe('ANALYSIS_DISABLED');
  });

  test('API: both routes require a session', async ({ apiClient }) => {
    expect((await apiClient.get('/stocks/AAPL/analysis/status')).status()).toBe(401);
    expect((await apiClient.post('/stocks/AAPL/analysis')).status()).toBe(401);
  });

  test('UI: the symbol page shows no Analyze button', async ({ playerPage }) => {
    await playerPage.goto('/symbols/AAPL');
    await expect(playerPage.getByText(/Last updated/i)).toBeVisible({ timeout: 10_000 });
    await expect(playerPage.getByRole('button', { name: /analyze/i })).toHaveCount(0);
  });
});

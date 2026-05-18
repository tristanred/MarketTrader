import { test, expect } from '../fixtures/base';
import { priceOf } from '../fixtures/mock-prices';

test.describe('Symbols', () => {
  test('API: search returns matches', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/search?q=AA', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const list = body.results ?? body;
    expect(list.some((r: { symbol: string }) => r.symbol === 'AAPL')).toBe(true);
  });

  test('API: quote returns the deterministic price', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const body = await res.json();
    expect(body.price).toBe(priceOf('AAPL'));
  });

  test('API: history returns bars', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL/history?range=1d', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect((body.bars ?? body).length).toBeGreaterThan(0);
  });

  test('API: details returns expected fields', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL/details', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.symbol).toBe('AAPL');
  });

  test('UI: SymbolPage shows the price', async ({ playerPage }) => {
    await playerPage.goto('/symbols/AAPL');
    await expect(playerPage.getByText('AAPL').first()).toBeVisible();
    await expect(
      playerPage.getByText(new RegExp(String(priceOf('AAPL')))).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

import { test, expect } from '../fixtures/base';

test('GET /health returns ok', async ({ apiClient }) => {
  const res = await apiClient.get('/health');
  expect(res.ok()).toBeTruthy();
});

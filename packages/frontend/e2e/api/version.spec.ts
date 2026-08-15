import { test, expect } from '../fixtures/base';

test('GET /version returns a build stamp', async ({ apiClient }) => {
  const res = await apiClient.get('/version');
  expect(res.ok()).toBeTruthy();

  const body = (await res.json()) as { version: string; commit: string; buildTime: string };
  expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(body.commit).not.toBe('');
});

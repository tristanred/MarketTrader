import { test, expect } from '../fixtures/base';

test.describe('Authentication', () => {
  test('register → land on games list', async ({ page, adminUser }) => {
    // Touch adminUser so the worker-scoped first-registered-admin user is
    // materialised before this test creates a fresh account via the UI.
    void adminUser;
    const username = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await page.goto('/register');
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill('correct-horse-battery');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();
  });

  test('login with valid credentials', async ({ page, registerUser }) => {
    const user = await registerUser();
    await page.goto('/login');
    await page.getByLabel(/username/i).fill(user.username);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
    await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();
  });

  test('login with wrong password shows error', async ({ page, registerUser }) => {
    const user = await registerUser();
    await page.goto('/login');
    await page.getByLabel(/username/i).fill(user.username);
    await page.getByLabel(/password/i).fill('definitely-not-it');
    await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong|failed/i)).toBeVisible();
  });

  test('logout clears session and redirects to login', async ({ playerPage }) => {
    await playerPage.getByRole('button', { name: /sign ?out|log ?out/i }).click();
    await expect(playerPage).toHaveURL(/.*\/login/);
  });

  test('refresh endpoint mints a new token', async ({ apiClient, playerUser }) => {
    const res = await apiClient.post('/auth/refresh', {
      headers: { Cookie: `refreshToken=${playerUser.cookies[0]?.value ?? ''}` },
    });
    expect(res.ok(), `refresh failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(typeof body.token).toBe('string');
  });

  test('logout endpoint clears refresh cookie', async ({ apiClient, playerUser }) => {
    const res = await apiClient.post('/auth/logout', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});

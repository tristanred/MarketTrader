import { test, expect } from './base';

test('admin and player are distinct users; admin can hit /admin/users', async ({
  adminUser,
  playerUser,
  apiClient,
}) => {
  expect(adminUser.userId).not.toBe(playerUser.userId);
  expect(adminUser.groups).toContain('admin');
  expect(playerUser.groups).not.toContain('admin');

  const ok = await apiClient.get('/admin/users', {
    headers: { Authorization: `Bearer ${adminUser.accessToken}` },
  });
  expect(ok.ok(), `admin /admin/users failed: ${ok.status()}`).toBeTruthy();

  const denied = await apiClient.get('/admin/users', {
    headers: { Authorization: `Bearer ${playerUser.accessToken}` },
  });
  expect(denied.status()).toBe(403);
});

test('makeGame + joinedPlayer create a game with the player inside', async ({
  makeGame,
  joinedPlayer,
  apiClient,
  adminUser,
}) => {
  const game = await makeGame();
  const player = await joinedPlayer(game.id);

  const res = await apiClient.get(`/admin/games/${game.id}/players`, {
    headers: { Authorization: `Bearer ${adminUser.accessToken}` },
  });
  expect(res.ok(), `list players failed: ${res.status()}`).toBeTruthy();
  expect(JSON.stringify(await res.json())).toContain(player.username);
});

test('pageAs lands logged in (no /login redirect)', async ({ playerPage }) => {
  await expect(playerPage).not.toHaveURL(/.*\/login(\/|$)/);
});

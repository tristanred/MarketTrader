import {
  test as base,
  request,
  expect,
  type APIRequestContext,
  type Page,
  type BrowserContext,
} from '@playwright/test';

const API_BASE = 'http://127.0.0.1:3000';

// Cookie path emitted by the API server. The Vite dev proxy rewrites this to
// `/api/auth/refresh` on the way back to the browser so it gets sent when the
// SPA calls `/api/auth/refresh`. When we inject cookies straight into a
// Playwright browser context (bypassing the proxy round-trip) we must use the
// already-rewritten path or the browser will not include the cookie.
const BROWSER_REFRESH_COOKIE_PATH = '/api/auth/refresh';

type Creds = { username: string; password: string };

type AuthCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

/** Captured state of an authenticated user after a register or login call. */
export type UserSession = {
  username: string;
  password: string;
  userId: string;
  accessToken: string;
  /** Cookies to inject into a browser context to land the SPA logged-in. */
  cookies: AuthCookie[];
  /** Raw refresh token (cookie value). */
  refreshToken: string | null;
  groups: string[];
};

type GameOpts = {
  name?: string;
  startDate?: string;
  endDate?: string;
  startingBalance?: number;
  /** Alias accepted for test ergonomics. Mapped to `startingBalance`. */
  startingCash?: number;
  allowShortSelling?: boolean;
  allowLimitOrders?: boolean;
  allowStopOrders?: boolean;
  allowBracketOrders?: boolean;
  allowGTC?: boolean;
};

/** Subset of the POST /games response that fixtures rely on. */
export type Game = {
  id: string;
  name: string;
};

export type Fixtures = {
  apiClient: APIRequestContext;
  registerUser: (opts?: Partial<Creds>) => Promise<UserSession>;
  loginAs: (creds: Creds) => Promise<UserSession>;
  playerUser: UserSession;
  makeGame: (opts?: GameOpts) => Promise<Game>;
  joinedPlayer: (gameId: string) => Promise<UserSession>;
  pageAs: (user: UserSession) => Promise<Page>;
  secondPage: (user: UserSession) => Promise<Page>;
  adminPage: Page;
  playerPage: Page;
};

export type WorkerFixtures = {
  adminUser: UserSession;
};

export function uniqueName(prefix: string): string {
  // Web Crypto (global, no import) — CSPRNG keeps usernames collision-free
  // without tripping CodeQL's js/insecure-randomness on Math.random().
  const rand = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return `${prefix}_${Date.now()}_${rand}`;
}

function extractRefreshToken(headers: Record<string, string>): string | null {
  const raw = headers['set-cookie'];
  if (!raw) return null;
  // Fastify can emit multiple Set-Cookie headers concatenated by newline in
  // Playwright's headers map. Match the first refreshToken value.
  const m = /refreshToken=([^;\s]+)/.exec(raw);
  return m && m[1] ? m[1] : null;
}

function authCookies(refreshToken: string | null): AuthCookie[] {
  if (!refreshToken) return [];
  return [
    {
      name: 'refreshToken',
      value: refreshToken,
      domain: '127.0.0.1',
      path: BROWSER_REFRESH_COOKIE_PATH,
    },
  ];
}

type AuthBody = {
  token: string;
  user: { id: string; username: string; groups: string[] };
};

export const testFixtures = base.extend<Fixtures, WorkerFixtures>({
  apiClient: async ({}, use) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    await use(ctx);
    await ctx.dispose();
  },

  registerUser: async ({ apiClient }, use) => {
    await use(async (opts) => {
      const username = opts?.username ?? uniqueName('user');
      const password = opts?.password ?? 'correct-horse-battery';
      const res = await apiClient.post('/auth/register', {
        data: { username, password },
      });
      expect(
        res.ok(),
        `register failed: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      const body = (await res.json()) as AuthBody;
      const refreshToken = extractRefreshToken(res.headers());
      return {
        username,
        password,
        userId: body.user.id,
        accessToken: body.token,
        cookies: authCookies(refreshToken),
        refreshToken,
        groups: body.user.groups ?? [],
      };
    });
  },

  loginAs: async ({ apiClient }, use) => {
    await use(async ({ username, password }) => {
      const res = await apiClient.post('/auth/login', {
        data: { username, password },
      });
      expect(
        res.ok(),
        `login failed: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      const body = (await res.json()) as AuthBody;
      const refreshToken = extractRefreshToken(res.headers());
      return {
        username,
        password,
        userId: body.user.id,
        accessToken: body.token,
        cookies: authCookies(refreshToken),
        refreshToken,
        groups: body.user.groups ?? [],
      };
    });
  },

  // Worker-scoped: the first registered user is auto-promoted to the admin
  // group by the server. We rely on this fixture being touched before any
  // other user is created in the worker — playerUser depends on adminUser
  // to enforce that ordering.
  adminUser: [
    async ({}, use) => {
      const ctx = await request.newContext({ baseURL: API_BASE });
      try {
        const username = uniqueName('admin');
        const password = 'correct-horse-battery';
        const res = await ctx.post('/auth/register', {
          data: { username, password },
        });
        expect(
          res.ok(),
          `admin register failed: ${res.status()} ${await res.text()}`,
        ).toBeTruthy();
        const body = (await res.json()) as AuthBody;
        const refreshToken = extractRefreshToken(res.headers());
        const session: UserSession = {
          username,
          password,
          userId: body.user.id,
          accessToken: body.token,
          cookies: authCookies(refreshToken),
          refreshToken,
          groups: body.user.groups ?? [],
        };
        expect(
          session.groups,
          `expected first registered user to be promoted to admin, got groups=${JSON.stringify(session.groups)}`,
        ).toContain('admin');
        await use(session);
      } finally {
        await ctx.dispose();
      }
    },
    { scope: 'worker' },
  ],

  playerUser: async ({ registerUser, adminUser }, use) => {
    // Depend on adminUser so the worker-scoped admin is materialised first;
    // otherwise the player would itself become the first registered user
    // and be auto-promoted.
    void adminUser;
    const user = await registerUser();
    await use(user);
  },

  makeGame: async ({ apiClient, adminUser }, use) => {
    await use(async (opts) => {
      const now = Date.now();
      const startDate =
        opts?.startDate ?? new Date(now - 60 * 60 * 1000).toISOString();
      const endDate =
        opts?.endDate ?? new Date(now + 60 * 60 * 1000).toISOString();
      const res = await apiClient.post('/games', {
        headers: { Authorization: `Bearer ${adminUser.accessToken}` },
        data: {
          name: opts?.name ?? uniqueName('game'),
          startDate,
          endDate,
          startingBalance:
            opts?.startingBalance ?? opts?.startingCash ?? 100_000,
          ...(opts?.allowShortSelling !== undefined && {
            allowShortSelling: opts.allowShortSelling,
          }),
          ...(opts?.allowLimitOrders !== undefined && {
            allowLimitOrders: opts.allowLimitOrders,
          }),
          ...(opts?.allowStopOrders !== undefined && {
            allowStopOrders: opts.allowStopOrders,
          }),
          ...(opts?.allowBracketOrders !== undefined && {
            allowBracketOrders: opts.allowBracketOrders,
          }),
          ...(opts?.allowGTC !== undefined && { allowGTC: opts.allowGTC }),
        },
      });
      expect(
        res.ok(),
        `makeGame failed: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      const body = (await res.json()) as { id: string; name: string };
      return { id: body.id, name: body.name };
    });
  },

  joinedPlayer: async ({ apiClient, registerUser }, use) => {
    await use(async (gameId) => {
      const user = await registerUser();
      const res = await apiClient.post(`/games/${gameId}/join`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      expect(
        res.ok(),
        `join failed: ${res.status()} ${await res.text()}`,
      ).toBeTruthy();
      return user;
    });
  },

  pageAs: async ({ browser }, use) => {
    const created: BrowserContext[] = [];
    await use(async (user) => {
      const ctx = await browser.newContext();
      created.push(ctx);
      if (user.cookies.length > 0) {
        await ctx.addCookies(user.cookies);
      }
      const page = await ctx.newPage();
      // The SPA calls /api/auth/refresh on load to restore the session from
      // the cookie. Wait for that round-trip so the page is ready in an
      // authenticated state before the test starts.
      const refresh = page
        .waitForResponse(
          (resp) =>
            resp.url().includes('/api/auth/refresh') && resp.status() === 200,
          { timeout: 10_000 },
        )
        .catch(() => null);
      await page.goto('/');
      await refresh;
      return page;
    });
    for (const c of created) await c.close();
  },

  secondPage: async ({ pageAs }, use) => {
    await use(pageAs);
  },

  adminPage: async ({ pageAs, adminUser }, use) => {
    const p = await pageAs(adminUser);
    await use(p);
  },

  playerPage: async ({ pageAs, playerUser }, use) => {
    const p = await pageAs(playerUser);
    await use(p);
  },
});

export const test = testFixtures;
export { expect };

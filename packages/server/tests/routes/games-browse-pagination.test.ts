import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BrowseGamesResponse } from '@markettrader/shared';
import { createTestApp } from '../helpers/app.js';

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

describe('GET /games/browse pagination', () => {
  let app: FastifyInstance;
  let viewer: string;
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const host = await register(app, 'page-host');
    viewer = await register(app, 'page-viewer');
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/games',
        headers: { Authorization: `Bearer ${host}` },
        payload: {
          name: `Paged ${i}`,
          startDate: '2099-01-01T00:00:00.000Z',
          endDate: '2099-06-01T00:00:00.000Z',
          startingBalance: 10_000,
        },
      });
      created.push(res.json<{ id: string }>().id);
    }
  });
  afterAll(() => app.close());

  function browse(query = '') {
    return app.inject({
      method: 'GET',
      url: `/games/browse${query}`,
      headers: { Authorization: `Bearer ${viewer}` },
    });
  }

  it('returns the first 20 games and the full total by default', async () => {
    const res = await browse();
    expect(res.statusCode).toBe(200);
    const body = res.json<BrowseGamesResponse>();
    expect(body.games).toHaveLength(20);
    expect(body.total).toBe(25);
  });

  it('pages with limit and offset without overlap', async () => {
    const first = (await browse('?limit=10&offset=0')).json<BrowseGamesResponse>();
    const second = (await browse('?limit=10&offset=10')).json<BrowseGamesResponse>();
    const third = (await browse('?limit=10&offset=20')).json<BrowseGamesResponse>();
    const ids = [...first.games, ...second.games, ...third.games].map((g) => g.id);
    expect(third.games).toHaveLength(5);
    expect(new Set(ids).size).toBe(25);
    expect(new Set(ids)).toEqual(new Set(created));
  });

  it('splits the full set into disjoint pages whose union is the whole list', async () => {
    const all = (await browse('?limit=50')).json<BrowseGamesResponse>().games.map((g) => g.id);
    const pages = await Promise.all(
      [0, 7, 14, 21].map(async (offset) =>
        (await browse(`?limit=7&offset=${offset}`)).json<BrowseGamesResponse>().games.map((g) => g.id),
      ),
    );
    const joined = pages.flat();
    expect(new Set(joined).size).toBe(joined.length);
    expect(joined).toEqual(all);
  });

  it('rejects a limit above 50 with 400', async () => {
    expect((await browse('?limit=51')).statusCode).toBe(400);
  });

  it('rejects a negative offset with 400', async () => {
    expect((await browse('?offset=-1')).statusCode).toBe(400);
  });

  it('returns an empty page past the end, still reporting the total', async () => {
    const body = (await browse('?offset=100')).json<BrowseGamesResponse>();
    expect(body.games).toEqual([]);
    expect(body.total).toBe(25);
  });
});

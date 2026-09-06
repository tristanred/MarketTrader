import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Watchlist } from '@markettrader/shared';
import { createTestApp } from '../helpers/app.js';

async function registerUser(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

async function createList(app: FastifyInstance, token: string, name: string): Promise<Watchlist> {
  const res = await app.inject({
    method: 'POST',
    url: '/watchlists',
    headers: { Authorization: `Bearer ${token}` },
    payload: { name },
  });
  return res.json<Watchlist>();
}

describe('Watchlist routes', () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    aliceToken = await registerUser(app, 'alice-watch');
    bobToken = await registerUser(app, 'bob-watch');
  });
  afterAll(() => app.close());

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/watchlists' });
    expect(res.statusCode).toBe(401);
  });

  it('starts with an empty list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('creates a watchlist and returns it with empty symbols', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { name: 'Tech' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Watchlist>();
    expect(body.name).toBe('Tech');
    expect(body.symbols).toEqual([]);
    expect(typeof body.id).toBe('string');
  });

  it('returns existing list when creating with a duplicate name (idempotent)', async () => {
    const first = await createList(app, aliceToken, 'Banks');
    const res = await app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { name: 'Banks' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Watchlist>().id).toBe(first.id);
  });

  it('rejects empty/blank names', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('renames a watchlist', async () => {
    const list = await createList(app, aliceToken, 'OldName');
    const res = await app.inject({
      method: 'PATCH',
      url: `/watchlists/${list.id}`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { name: 'NewName' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Watchlist>().name).toBe('NewName');
  });

  it('returns 404 when renaming someone else\'s list', async () => {
    const list = await createList(app, aliceToken, 'AliceOnly');
    const res = await app.inject({
      method: 'PATCH',
      url: `/watchlists/${list.id}`,
      headers: { Authorization: `Bearer ${bobToken}` },
      payload: { name: 'Stolen' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('adds a symbol and uppercases it', async () => {
    const list = await createList(app, aliceToken, 'AddSymbols');
    const res = await app.inject({
      method: 'POST',
      url: `/watchlists/${list.id}/items`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { symbol: 'aapl' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Watchlist>().symbols).toEqual(['AAPL']);
  });

  it('adding the same symbol twice is a no-op', async () => {
    const list = await createList(app, aliceToken, 'DupSymbols');
    await app.inject({
      method: 'POST',
      url: `/watchlists/${list.id}/items`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { symbol: 'MSFT' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/watchlists/${list.id}/items`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { symbol: 'msft' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Watchlist>().symbols).toEqual(['MSFT']);
  });

  it('removes a symbol', async () => {
    const list = await createList(app, aliceToken, 'RemSymbols');
    await app.inject({
      method: 'POST',
      url: `/watchlists/${list.id}/items`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { symbol: 'TSLA' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/watchlists/${list.id}/items/tsla`,
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Watchlist>().symbols).toEqual([]);
  });

  it('deleting a watchlist cascades its items', async () => {
    const list = await createList(app, aliceToken, 'DeleteMe');
    await app.inject({
      method: 'POST',
      url: `/watchlists/${list.id}/items`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { symbol: 'NVDA' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/watchlists/${list.id}`,
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(del.statusCode).toBe(204);

    // Re-creating with the same name should yield zero symbols (items gone).
    const recreated = await createList(app, aliceToken, 'DeleteMe');
    expect(recreated.symbols).toEqual([]);
  });

  it('does not leak another user\'s lists in GET', async () => {
    await createList(app, aliceToken, 'AlicePrivate');
    const res = await app.inject({
      method: 'GET',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const names = res.json<Watchlist[]>().map((w) => w.name);
    expect(names).not.toContain('AlicePrivate');
  });

  it('rejects invalid symbol format', async () => {
    const list = await createList(app, aliceToken, 'InvalidSym');
    const res = await app.inject({
      method: 'POST',
      url: `/watchlists/${list.id}/items`,
      headers: { Authorization: `Bearer ${aliceToken}` },
      payload: { symbol: '123BAD' },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('symbol notes', () => {
    async function listWith(token: string, name: string, symbol: string): Promise<Watchlist> {
      const list = await createList(app, token, name);
      await app.inject({
        method: 'POST',
        url: `/watchlists/${list.id}/items`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { symbol },
      });
      return list;
    }

    it('omits notes for symbols that have none', async () => {
      const list = await listWith(aliceToken, 'NoteEmpty', 'AAPL');
      const res = await app.inject({
        method: 'GET',
        url: '/watchlists',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      const found = res.json<Watchlist[]>().find((w) => w.id === list.id);
      expect(found?.symbols).toEqual(['AAPL']);
      expect(found?.notes ?? {}).toEqual({});
    });

    it('stores a note against the symbol and returns the updated list', async () => {
      const list = await listWith(aliceToken, 'NoteWrite', 'NVDA');
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/NVDA`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'Add under 900. Earnings 11/19.' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Watchlist>().notes).toEqual({ NVDA: 'Add under 900. Earnings 11/19.' });
    });

    it('surfaces a stored note on GET /watchlists', async () => {
      const list = await listWith(aliceToken, 'NoteRead', 'MSFT');
      await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/MSFT`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'Azure margin watch' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/watchlists',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      const found = res.json<Watchlist[]>().find((w) => w.id === list.id);
      expect(found?.notes).toEqual({ MSFT: 'Azure margin watch' });
    });

    it('lowercases in the path still match the stored symbol', async () => {
      const list = await listWith(aliceToken, 'NoteCase', 'TSLA');
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/tsla`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'delivery numbers' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Watchlist>().notes).toEqual({ TSLA: 'delivery numbers' });
    });

    it('clears the note when sent an empty string', async () => {
      const list = await listWith(aliceToken, 'NoteClear', 'AMD');
      await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/AMD`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'temporary' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/AMD`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: '' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Watchlist>().notes ?? {}).toEqual({});
    });

    it('treats a whitespace-only note as a clear', async () => {
      const list = await listWith(aliceToken, 'NoteBlank', 'INTC');
      await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/INTC`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'something' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/INTC`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: '   \n  ' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Watchlist>().notes ?? {}).toEqual({});
    });

    it('404s for a symbol that is not on the list', async () => {
      const list = await listWith(aliceToken, 'NoteMissing', 'AAPL');
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/GOOG`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'never added' },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s on another user's list rather than leaking its existence", async () => {
      const list = await listWith(aliceToken, 'NoteForeign', 'AAPL');
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/AAPL`,
        headers: { Authorization: `Bearer ${bobToken}` },
        payload: { note: 'not mine' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects a note past the 1000-character cap', async () => {
      const list = await listWith(aliceToken, 'NoteTooLong', 'AAPL');
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/AAPL`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'x'.repeat(1001) },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts a note exactly at the cap', async () => {
      const list = await listWith(aliceToken, 'NoteAtCap', 'AAPL');
      const res = await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/AAPL`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'x'.repeat(1000) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Watchlist>().notes?.['AAPL']).toHaveLength(1000);
    });

    it('drops the note when the symbol is removed from the list', async () => {
      const list = await listWith(aliceToken, 'NoteEvict', 'AAPL');
      await app.inject({
        method: 'PATCH',
        url: `/watchlists/${list.id}/items/AAPL`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { note: 'gone soon' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/watchlists/${list.id}/items/AAPL`,
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      await app.inject({
        method: 'POST',
        url: `/watchlists/${list.id}/items`,
        headers: { Authorization: `Bearer ${aliceToken}` },
        payload: { symbol: 'AAPL' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/watchlists',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      const found = res.json<Watchlist[]>().find((w) => w.id === list.id);
      expect(found?.notes ?? {}).toEqual({});
    });
  });
});

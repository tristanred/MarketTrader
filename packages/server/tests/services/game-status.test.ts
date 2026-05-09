import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { recomputeGameStatus, recomputeMany } from '../../src/services/game-status.js';
import { schema } from '../../src/db/index.js';

describe('game-status service', () => {
  let db: ReturnType<typeof createTestDb>;
  let userId: string;

  beforeAll(async () => {
    db = createTestDb();
    const rows = await db.insert(schema.users).values({ username: 'alice', passwordHash: 'x' }).returning({ id: schema.users.id });
    const user = rows[0];
    if (!user) throw new Error('Failed to insert test user');
    userId = user.id;
  });

  async function insertGame(startDate: string, endDate: string, status: 'pending' | 'active' | 'ended' = 'pending') {
    const rows = await db.insert(schema.games).values({
      name: 'Test',
      startDate,
      endDate,
      startingBalance: 10000,
      status,
      createdBy: userId,
    }).returning();
    const g = rows[0];
    if (!g) throw new Error('Failed to insert test game');
    return g;
  }

  it('transitions pending → active when startDate has passed', async () => {
    const g = await insertGame('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    const status = await recomputeGameStatus(db, g);
    expect(status).toBe('active');
  });

  it('transitions active → ended when endDate has passed', async () => {
    const g = await insertGame('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'active');
    const status = await recomputeGameStatus(db, g);
    expect(status).toBe('ended');
  });

  it('does not change ended status', async () => {
    const g = await insertGame('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'ended');
    const status = await recomputeGameStatus(db, g);
    expect(status).toBe('ended');
  });

  it('keeps pending when startDate is in the future', async () => {
    const g = await insertGame('2099-01-01T00:00:00.000Z', '2099-06-01T00:00:00.000Z');
    const status = await recomputeGameStatus(db, g);
    expect(status).toBe('pending');
  });

  it('recomputeMany returns statuses for all games', async () => {
    const g1 = await insertGame('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    const g2 = await insertGame('2099-01-01T00:00:00.000Z', '2099-06-01T00:00:00.000Z');
    const map = await recomputeMany(db, [g1, g2]);
    expect(map.get(g1.id)).toBe('active');
    expect(map.get(g2.id)).toBe('pending');
  });
});

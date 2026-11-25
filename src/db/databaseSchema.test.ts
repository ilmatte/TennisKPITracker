import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { db, TennisDatabase } from './database';
import { POINT_TYPES } from '../features/scoring/pointTypes';

const databaseName = 'TennisKPITrackerSchemaTest';

afterEach(async () => {
  db.close();
  await Dexie.delete(databaseName);
});

describe('local database schema', () => {
  it('creates every store aligned with the Supabase tables and seeds point_types', async () => {
    const fresh = new TennisDatabase(databaseName);
    await fresh.open();
    expect(fresh.verno).toBe(7);
    expect(fresh.tables.map(table => table.name).sort()).toEqual([
      'families', 'family_invitations', 'family_members', 'games', 'matches', 'players',
      'point_types', 'points', 'sets', 'syncConflicts', 'syncMetadata', 'syncQueue',
    ]);
    expect(await fresh.table('point_types').toArray()).toEqual([...POINT_TYPES]);
    const pointIndexes = fresh.points.schema.indexes.map(index => index.name);
    expect(pointIndexes).toContain('point_type_id');
    expect(pointIndexes).toContain('[game_id+point_number]');
    expect(fresh.syncQueue.schema.indexes.find(index => index.name === 'operation_id')).toBeDefined();
    fresh.close();
  });

  it('reopens an existing database without seeding point_types twice', async () => {
    const first = new TennisDatabase(databaseName);
    await first.open();
    first.close();
    const reopened = new TennisDatabase(databaseName);
    await reopened.open();
    expect(await reopened.table('point_types').count()).toBe(POINT_TYPES.length);
    reopened.close();
  });
});

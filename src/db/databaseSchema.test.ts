import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { db, TennisDatabase } from './database';
import { POINT_TYPES } from '../features/scoring/pointTypes';
import { PLAYER_AGE_CATEGORIES } from '../features/players/ageCategories';

const databaseName = 'TennisKPITrackerSchemaTest';

afterEach(async () => {
  db.close();
  await Dexie.delete(databaseName);
});

describe('local database schema', () => {
  it('creates every store aligned with the Supabase tables and seeds the reference tables', async () => {
    const fresh = new TennisDatabase(databaseName);
    await fresh.open();
    expect(fresh.verno).toBe(11);
    expect(fresh.tables.map(table => table.name).sort()).toEqual([
      'clubs', 'families', 'family_invitations', 'family_members', 'games', 'matches', 'player_age_categories', 'players',
      'point_types', 'points', 'sets', 'syncConflicts', 'syncMetadata', 'syncQueue',
    ]);
    expect(await fresh.table('point_types').toArray()).toEqual([...POINT_TYPES]);
    expect(await fresh.table('player_age_categories').toArray()).toEqual([...PLAYER_AGE_CATEGORIES]);
    const pointIndexes = fresh.points.schema.indexes.map(index => index.name);
    expect(pointIndexes).toContain('point_type_id');
    expect(pointIndexes).toContain('[game_id+point_number]');
    expect(fresh.syncQueue.schema.indexes.find(index => index.name === 'operation_id')).toBeDefined();
    fresh.close();
  });

  it('opens a database created by an older app version and seeds the reference tables', async () => {
    const older = new Dexie(databaseName);
    older.version(7).stores({
      families: 'id, created_by, local_only, updated_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      point_types: 'id, &code',
    });
    await older.open();
    const player = {
      id: 'p1', family_id: 'f1', first_name: 'Ada', last_name: 'Lovelace', birth_date: '2014-06-15',
      ranking: '4.1', created_at: 'x', updated_at: 'x', version: 1, deleted: false,
    };
    await older.table('players').add(player);
    older.close();

    const reopened = new TennisDatabase(databaseName);
    await reopened.open();
    expect(reopened.verno).toBe(11);
    expect(await reopened.table('point_types').toArray()).toEqual([...POINT_TYPES]);
    expect(await reopened.table('player_age_categories').toArray()).toEqual([...PLAYER_AGE_CATEGORIES]);
    expect(await reopened.table('players').get('p1')).toEqual(player);
    expect(reopened.players.schema.indexes.map(index => index.name)).not.toContain('category');
    reopened.close();
  });

  it('reopens an existing database without seeding the reference tables twice', async () => {
    const first = new TennisDatabase(databaseName);
    await first.open();
    first.close();
    const reopened = new TennisDatabase(databaseName);
    await reopened.open();
    expect(await reopened.table('point_types').count()).toBe(POINT_TYPES.length);
    expect(await reopened.table('player_age_categories').count()).toBe(PLAYER_AGE_CATEGORIES.length);
    reopened.close();
  });
});

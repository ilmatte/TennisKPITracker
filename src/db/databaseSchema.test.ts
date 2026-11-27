import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { db, TennisDatabase } from './database';
import { POINT_TYPES } from '../features/scoring/pointTypes';
import { PLAYER_AGE_CATEGORIES } from '../features/players/ageCategories';
import { STATUSES } from '../features/statuses/statuses';

const databaseName = 'TennisKPITrackerSchemaTest';

afterEach(async () => {
  db.close();
  await Dexie.delete(databaseName);
});

describe('local database schema', () => {
  it('creates every store aligned with the Supabase tables and seeds the reference tables', async () => {
    const fresh = new TennisDatabase(databaseName);
    await fresh.open();
    expect(fresh.verno).toBe(14);
    expect(fresh.tables.map(table => table.name).sort()).toEqual([
      'clubs', 'families', 'family_invitations', 'family_members', 'games', 'matches', 'player_age_categories', 'players',
      'point_types', 'points', 'sets', 'statuses', 'syncConflicts', 'syncMetadata', 'syncQueue', 'tournaments',
    ]);
    expect(await fresh.table('point_types').toArray()).toEqual([...POINT_TYPES]);
    expect(await fresh.table('player_age_categories').toArray()).toEqual([...PLAYER_AGE_CATEGORIES]);
    expect(await fresh.table('statuses').toArray()).toEqual([...STATUSES]);
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
    expect(reopened.verno).toBe(14);
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

  it('upgrades a version 11 database to tournaments keeping its clubs and matches without the free-text tournament', async () => {
    const older = new Dexie(databaseName);
    older.version(11).stores({
      clubs: 'id, family_id, name, city, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
    });
    await older.open();
    const club = { id: 'c1', family_id: 'f1', name: 'TC Lambrate', city: 'Milano', surface: null };
    const match = { id: 'm1', family_id: 'f1', match_date: '2026-01-01', player_id: 'p1', status: 'completed', tournament: 'Open' };
    await older.table('clubs').add(club);
    await older.table('matches').add(match);
    older.close();

    const upgraded = new TennisDatabase(databaseName);
    await upgraded.open();
    expect(upgraded.verno).toBe(14);
    expect(await upgraded.table('clubs').get('c1')).toEqual(club);
    // The free-text tournament is removed; matches created before tournaments have no tournament_id. The text status
    // becomes status_id (v14).
    const { tournament: _removed, status: _status, ...rest } = match;
    expect(await upgraded.table('matches').get('m1')).toEqual({ ...rest, status_id: 3 });
    expect(upgraded.matches.schema.indexes.map(index => index.name)).toContain('tournament_id');
    expect(upgraded.matches.schema.indexes.map(index => index.name)).not.toContain('tournament');
    expect(upgraded.tournaments.schema.indexes.map(index => index.name)).toEqual(
      expect.arrayContaining(['family_id', 'club_id', 'start_date']),
    );
    upgraded.close();
  });

  it('upgrades a version 12 database giving its tournaments the "upcoming" status (then converted to status_id)', async () => {
    const older = new Dexie(databaseName);
    older.version(12).stores({ tournaments: 'id, family_id, club_id, start_date, updated_at, deleted' });
    await older.open();
    await older.table('tournaments').bulkAdd([
      { id: 't1', family_id: 'f1', name: 'Senza stato' },
      { id: 't2', family_id: 'f1', name: 'Stato nullo', status: null },
      { id: 't3', family_id: 'f1', name: 'Concluso', status: 'completed' },
    ]);
    older.close();

    const upgraded = new TennisDatabase(databaseName);
    await upgraded.open();
    expect(upgraded.verno).toBe(14);
    expect((await upgraded.tournaments.toArray()).map(item => [item.id, item.status_id, 'status' in item])).toEqual([
      ['t1', 1, false], ['t2', 1, false], ['t3', 3, false],
    ]);
    upgraded.close();
  });
});

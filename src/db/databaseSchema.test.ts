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
  it('creates every store aligned with the Supabase tables and seeds point_types', async () => {
    const fresh = new TennisDatabase(databaseName);
    await fresh.open();
    expect(fresh.verno).toBe(10);
    expect(fresh.tables.map(table => table.name).sort()).toEqual([
      'families', 'family_invitations', 'family_members', 'games', 'matches', 'player_age_categories', 'players',
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

  it('upgrades a version 7 database: seeds player_age_categories and removes the dropped player and match fields', async () => {
    const v7 = new Dexie(databaseName);
    v7.version(7).stores({
      families: 'id, created_by, local_only, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, &[game_id+point_number], point_number, point_type_id, updated_at, deleted',
      point_types: 'id, &code',
      syncQueue: 'id, operation_id, family_id, entity_type, entity_id, created_at, attempts',
      syncMetadata: 'key, updated_at',
      syncConflicts: 'id, family_id, entity_type, entity_id, status, created_at',
    });
    await v7.open();
    const player = {
      id: 'p1', family_id: 'f1', first_name: 'Ada', last_name: 'Lovelace', birth_date: '2014-06-15',
      category: 'U14', ranking: '4.1', created_at: 'x', updated_at: 'x', version: 1, deleted: false,
    };
    const match = {
      id: 'm1', family_id: 'f1', match_date: '2026-03-01', player_id: 'p1', player_first_name_snapshot: 'Ada',
      player_last_name_snapshot: 'Lovelace', player_ranking_snapshot: '4.1', player_category_snapshot: 'U14',
      opponent: 'Bea', opponent_ranking: '3.5', opponent_category: 'U16', version: 1, deleted: false,
    };
    await v7.table('point_types').bulkAdd([...POINT_TYPES]);
    await v7.table('players').add(player);
    await v7.table('matches').add(match);
    await v7.table('syncQueue').add({
      id: 'q1', operation_id: 'o1', family_id: 'f1', entity_type: 'matches', entity_id: 'm1', operation: 'upsert',
      payload: match, created_at: 'x', attempts: 0,
    });
    v7.close();

    const upgraded = new TennisDatabase(databaseName);
    await upgraded.open();
    expect(upgraded.verno).toBe(10);
    expect(await upgraded.table('player_age_categories').toArray()).toEqual([...PLAYER_AGE_CATEGORIES]);
    expect(await upgraded.table('point_types').count()).toBe(POINT_TYPES.length);
    // players.category is removed (now computed); the FITP ranking and the other fields are left untouched.
    const { category: _category, ...playerWithoutCategory } = player;
    expect(await upgraded.table('players').get('p1')).toEqual(playerWithoutCategory);
    expect(upgraded.players.schema.indexes.map(index => index.name)).not.toContain('category');
    // The name and category snapshots and opponent_category are removed from matches and from queued operations;
    // the ranking snapshot is kept.
    const {
      player_first_name_snapshot: _first, player_last_name_snapshot: _last, player_category_snapshot: _categorySnapshot,
      opponent_category: _opponentCategory, ...matchWithoutRemoved
    } = match;
    expect(await upgraded.table('matches').get('m1')).toEqual(matchWithoutRemoved);
    expect((await upgraded.table('syncQueue').get('q1')).payload).toEqual(matchWithoutRemoved);
    upgraded.close();
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

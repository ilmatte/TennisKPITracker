import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { db, TennisDatabase } from './database';

const databaseName = 'TennisKPITrackerMigrationTest';

afterEach(async () => {
  db.close();
  await Dexie.delete(databaseName);
});

describe('sync metadata schema migration', () => {
  it('adds metadata and conflict stores without changing existing sports data', async () => {
    const legacy = new Dexie(databaseName);
    legacy.version(1).stores({
      families: 'id, created_by, local_only, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, &[game_id+point_number], point_number, winner, server, updated_at, deleted',
      syncQueue: 'id, family_id, entity_type, entity_id, created_at, attempts',
    });
    await legacy.open();
    const family = {
      id: 'local-family', name: 'Local', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z', created_by: null, local_only: true,
    };
    const player = {
      id: 'player-id', family_id: family.id, first_name: 'Ada', last_name: 'Lovelace',
      birth_date: null, category: 'U16', ranking: '4.1', created_at: family.created_at,
      updated_at: family.updated_at, version: 1, deleted: false,
    };
    const operation = {
      id: 'queue-id', family_id: family.id, entity_type: 'players', entity_id: player.id,
      operation: 'upsert', payload: player, created_at: family.created_at, attempts: 0,
    };
    await legacy.table('families').add(family);
    await legacy.table('players').add(player);
    await legacy.table('syncQueue').add(operation);
    legacy.close();

    const migrated = new TennisDatabase(databaseName);
    await migrated.open();
    expect(migrated.verno).toBe(3);
    expect(await migrated.table('families').get(family.id)).toEqual(family);
    expect(await migrated.table('players').get(player.id)).toEqual(player);
    expect(await migrated.table('syncQueue').get(operation.id)).toEqual(operation);
    expect(migrated.tables.map(table => table.name)).toContain('syncMetadata');
    expect(migrated.tables.map(table => table.name)).toContain('syncConflicts');
    expect(migrated.syncQueue.schema.indexes.find(index => index.name === 'operation_id')).toBeDefined();
    expect(await migrated.table('syncMetadata').count()).toBe(0);
    expect(await migrated.table('syncConflicts').count()).toBe(0);
    migrated.close();
  });
});

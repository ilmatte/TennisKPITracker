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
    expect(migrated.verno).toBe(4);
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

  it('converts points.winner into the boolean points.won, including queued operations and conflicts', async () => {
    const legacy = new Dexie(databaseName);
    legacy.version(3).stores({
      families: 'id, created_by, local_only, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, &[game_id+point_number], point_number, winner, server, updated_at, deleted',
      syncQueue: 'id, operation_id, family_id, entity_type, entity_id, created_at, attempts',
      syncMetadata: 'key, updated_at',
      syncConflicts: 'id, family_id, entity_type, entity_id, status, created_at',
    });
    await legacy.open();
    const point = (id: string, winner: 'player' | 'opponent', point_number: number) => ({
      id, family_id: 'f1', game_id: 'g1', point_number, winner, server: 'player', second_serve: false,
      double_fault: false, shot_count: 1, free_error: false, attack_error: false, pressure_situation: false,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', version: 1, deleted: false,
    });
    await legacy.table('points').bulkAdd([point('won-point', 'player', 1), point('lost-point', 'opponent', 2)]);
    await legacy.table('syncQueue').add({
      id: 'queue-point', operation_id: 'op-1', family_id: 'f1', entity_type: 'points', entity_id: 'lost-point',
      operation: 'upsert', payload: point('lost-point', 'opponent', 2), created_at: '2026-01-01T00:00:00.000Z', attempts: 0,
    });
    await legacy.table('syncConflicts').add({
      id: 'conflict-point', family_id: 'f1', entity_type: 'points', entity_id: 'won-point', base_version: 1,
      reason: 'version', local_payload: point('won-point', 'player', 1), remote_payload: point('won-point', 'opponent', 1),
      remote_version: 2, status: 'unresolved', created_at: '2026-01-01T00:00:00.000Z', resolved_at: null,
    });
    legacy.close();

    const migrated = new TennisDatabase(databaseName);
    await migrated.open();
    const wonPoint = await migrated.table('points').get('won-point');
    const lostPoint = await migrated.table('points').get('lost-point');
    expect(wonPoint).toMatchObject({ won: true });
    expect(lostPoint).toMatchObject({ won: false });
    expect(wonPoint).not.toHaveProperty('winner');
    expect(migrated.points.schema.indexes.map(index => index.name)).not.toContain('winner');
    const queued = await migrated.table('syncQueue').get('queue-point');
    expect(queued.payload).toMatchObject({ won: false });
    expect(queued.payload).not.toHaveProperty('winner');
    const conflict = await migrated.table('syncConflicts').get('conflict-point');
    expect(conflict.local_payload).toMatchObject({ won: true });
    expect(conflict.remote_payload).toMatchObject({ won: false });
    migrated.close();
  });
});

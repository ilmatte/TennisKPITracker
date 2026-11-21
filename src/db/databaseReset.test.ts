import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db, resetLocalDatabaseOnce } from './database';

function createLegacyDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TennisKPITracker', 4);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('legacy');
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

afterEach(() => {
  db.close();
});

describe('local database reset', () => {
  it('resets the old database once and then initializes the single current schema', async () => {
    localStorage.removeItem('tennis-kpi-dexie-reset-v1');
    await createLegacyDatabase();

    await resetLocalDatabaseOnce();
    await db.open();

    expect(db.verno).toBe(2);
    expect(db.tables.map(table => table.name)).toEqual([
      'families',
      'family_members',
      'family_invitations',
      'players',
      'matches',
      'sets',
      'games',
      'points',
      'syncQueue',
      'syncMetadata',
      'syncConflicts',
    ]);
    expect(db.sets.schema.indexes.find(index => index.name === '[match_id+set_number]')?.unique).toBe(true);
    expect(db.games.schema.indexes.find(index => index.name === '[set_id+game_number]')?.unique).toBe(true);
    expect(db.points.schema.indexes.find(index => index.name === '[game_id+point_number]')?.unique).toBe(true);
    expect(localStorage.getItem('tennis-kpi-dexie-reset-v1')).toBe('done');

    await db.families.add({
      id: 'preserved-after-reset',
      name: 'Tennis KPI Tracker',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      created_by: null,
      local_only: true,
    });
    await resetLocalDatabaseOnce();

    expect(await db.families.get('preserved-after-reset')).toBeDefined();
  });
});

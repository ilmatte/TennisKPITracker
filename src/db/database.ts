import Dexie, { type EntityTable } from 'dexie';
import type { Match, Player, Point, SyncOperation } from '../types';

class TennisDatabase extends Dexie {
  players!: EntityTable<Player, 'id'>;
  matches!: EntityTable<Match, 'id'>;
  points!: EntityTable<Point, 'id'>;
  syncQueue!: EntityTable<SyncOperation, 'id'>;

  constructor() {
    super('TennisKPITracker');
    this.version(1).stores({
      players: 'id, firstName, lastName, ranking, category, updatedAt, deleted',
      matches: 'id, matchDate, playerId, status, tournament, updatedAt, deleted',
      points: 'id, matchId, setNumber, gameNumber, pointNumber, winner, server, updatedAt, deleted',
      syncQueue: 'id, entityType, entityId, createdAt, attempts',
    });
  }
}

export const db = new TennisDatabase();

export async function persistSnapshotStorage(): Promise<void> {
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch { /* Storage persistence is optional. */ }
  }
}

export async function seedPlayers(): Promise<void> {
  if (await db.players.count()) return;
  const now = new Date().toISOString();
  await db.players.bulkPut([
    { id: crypto.randomUUID(), firstName: 'Alessandro', lastName: '', birthDate: '', category: 'U16', ranking: '4.1', createdAt: now, updatedAt: now, version: 1 },
    { id: crypto.randomUUID(), firstName: 'Andrea', lastName: '', birthDate: '', category: 'U16', ranking: '4.1', createdAt: now, updatedAt: now, version: 1 },
  ]);
}

import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  Family,
  FamilyInvitation,
  FamilyMember,
  Game,
  Match,
  Player,
  Point,
  ScoredPoint,
  SyncOperation,
  TennisSet,
} from '../types';
import { normalizeDuplicatePointNumbers } from './pointNumbers';

class TennisDatabase extends Dexie {
  families!: EntityTable<Family, 'id'>;
  family_members!: Table<FamilyMember, [string, string]>;
  family_invitations!: EntityTable<FamilyInvitation, 'id'>;
  players!: EntityTable<Player, 'id'>;
  matches!: EntityTable<Match, 'id'>;
  sets!: EntityTable<TennisSet, 'id'>;
  games!: EntityTable<Game, 'id'>;
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
    this.version(2).stores({
      families: 'id, created_by, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, point_number, winner, server, updated_at, deleted',
      syncQueue: 'id, family_id, entity_type, entity_id, created_at, attempts',
    }).upgrade(async transaction => {
      await Promise.all([
        transaction.table('players').clear(),
        transaction.table('matches').clear(),
        transaction.table('points').clear(),
        transaction.table('syncQueue').clear(),
      ]);
    });
    this.version(3).stores({
      families: 'id, created_by, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, point_number, [game_id+point_number], winner, server, updated_at, deleted',
      syncQueue: 'id, family_id, entity_type, entity_id, created_at, attempts',
    }).upgrade(async transaction => {
      const points = transaction.table('points');
      const updates = normalizeDuplicatePointNumbers(await points.toArray());
      if (updates.length) await points.bulkPut(updates);
    });
    this.version(4).stores({
      families: 'id, created_by, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, category, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, point_number, &[game_id+point_number], winner, server, updated_at, deleted',
      syncQueue: 'id, family_id, entity_type, entity_id, created_at, attempts',
    });
  }
}

export const db = new TennisDatabase();

export async function persistSnapshotStorage(): Promise<void> {
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch { /* Storage persistence is optional. */ }
  }
}

export async function removeLocalFamily(familyId: string): Promise<void> {
  await db.transaction('rw', [
    db.families,
    db.family_members,
    db.family_invitations,
    db.players,
    db.matches,
    db.sets,
    db.games,
    db.points,
    db.syncQueue,
  ], async () => {
      await db.points.where('family_id').equals(familyId).delete();
      await db.games.where('family_id').equals(familyId).delete();
      await db.sets.where('family_id').equals(familyId).delete();
      await db.matches.where('family_id').equals(familyId).delete();
      await db.players.where('family_id').equals(familyId).delete();
      await db.family_invitations.where('family_id').equals(familyId).delete();
      await db.family_members.where('family_id').equals(familyId).delete();
      await db.syncQueue.where('family_id').equals(familyId).delete();
      await db.families.delete(familyId);
  });
}

export async function getMatchPoints(familyId: string, matchId: string): Promise<ScoredPoint[]> {
  return db.transaction('r', db.sets, db.games, db.points, async () => {
    const sets = await db.sets.where('family_id').equals(familyId)
      .filter(set => set.match_id === matchId && !set.deleted)
      .toArray();
    if (!sets.length) return [];
    const games = await db.games.where('family_id').equals(familyId)
      .filter(game => sets.some(set => set.id === game.set_id) && !game.deleted)
      .toArray();
    if (!games.length) return [];
    const points = await db.points.where('game_id').anyOf(games.map(game => game.id)).toArray();
    const gameById = new Map(games.map(game => [game.id, game]));
    const setById = new Map(sets.map(set => [set.id, set]));
    return points.flatMap(point => {
      if (point.deleted || point.family_id !== familyId) return [];
      const game = gameById.get(point.game_id);
      const set = game ? setById.get(game.set_id) : undefined;
      return game && set
        ? [{ ...point, set_number: set.set_number, game_number: game.game_number }]
        : [];
    }).sort((a, b) => a.set_number - b.set_number || a.game_number - b.game_number || a.point_number - b.point_number);
  });
}

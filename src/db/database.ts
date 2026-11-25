import Dexie, { type EntityTable, type Table } from 'dexie';
import { POINT_TYPES } from '../features/scoring/pointTypes';
import type {
  Family,
  FamilyInvitation,
  FamilyMember,
  Game,
  Match,
  Player,
  Point,
  PointType,
  ScoredPoint,
  SyncOperation,
  SyncConflict,
  SyncMetadata,
  TennisSet,
} from '../types';

export class TennisDatabase extends Dexie {
  families!: EntityTable<Family, 'id'>;
  family_members!: Table<FamilyMember, [string, string]>;
  family_invitations!: EntityTable<FamilyInvitation, 'id'>;
  players!: EntityTable<Player, 'id'>;
  matches!: EntityTable<Match, 'id'>;
  sets!: EntityTable<TennisSet, 'id'>;
  games!: EntityTable<Game, 'id'>;
  points!: EntityTable<Point, 'id'>;
  point_types!: Table<PointType, number>;
  syncQueue!: EntityTable<SyncOperation, 'id'>;
  syncMetadata!: EntityTable<SyncMetadata, 'key'>;
  syncConflicts!: EntityTable<SyncConflict, 'id'>;

  constructor(name = 'TennisKPITracker') {
    super(name);
    // Single schema version, aligned with supabase/initial_schema.sql. The number stays at 7 (the last version that
    // shipped with step-by-step migrations) because browsers refuse to open a database with a lower version than the
    // one already stored on the device. A new schema change adds version(8) with its own upgrade.
    // Booleans (points.won, points.serving, ...) are not valid IndexedDB keys, so they are stored but not indexed.
    this.version(7).stores({
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
    // The point_types lookup table is seeded when the database is created (same rows as supabase/initial_schema.sql).
    this.on('populate', transaction => transaction.table('point_types').bulkAdd([...POINT_TYPES]));
  }
}

export const db = new TennisDatabase();

let databaseInitializationPromise: Promise<void> | null = null;

export function resetLocalDatabaseOnce(): Promise<void> {
  if (!databaseInitializationPromise) {
    databaseInitializationPromise = db.open()
      .then(() => undefined)
      .catch(cause => {
        databaseInitializationPromise = null;
        throw cause;
      });
  }
  return databaseInitializationPromise;
}

export async function ensureLocalWorkspace(): Promise<Family> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return db.transaction('rw', db.families, async () => {
    const workspaces = (await db.families.toArray()).filter(family => family.local_only);
    if (workspaces.length > 1) {
      throw new Error(
        `Incoerenza nei dati locali: trovati ${workspaces.length} workspace locali. ` +
        'Nessun dato è stato modificato; è necessario risolvere i duplicati prima di continuare.',
      );
    }
    if (workspaces.length === 1) return workspaces[0];

    const workspace: Family = {
      id,
      name: 'Tennis KPI Tracker',
      created_at: now,
      updated_at: now,
      created_by: null,
      local_only: true,
    };
    await db.families.add(workspace);
    return workspace;
  });
}

export async function persistSnapshotStorage(): Promise<void> {
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch { /* Storage persistence is optional. */ }
  }
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

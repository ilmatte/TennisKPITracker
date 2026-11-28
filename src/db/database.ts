import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie';
import { migrateLegacyMatchColumns } from '../features/matches/legacyMatch';
import { POINT_TYPES } from '../features/scoring/pointTypes';
import { PLAYER_AGE_CATEGORIES } from '../features/players/ageCategories';
import { FITP_RANKINGS, migrateLegacyPlayerRanking } from '../features/players/fitpRankings';
import { STATUS, STATUSES, migrateLegacyStatus } from '../features/statuses/statuses';
import { withDerivedGameStatuses, withDerivedSetStatuses } from '../features/scoring/setStatuses';
import type {
  Club,
  Family,
  FamilyInvitation,
  FamilyMember,
  FitpRanking,
  Game,
  Match,
  Player,
  Point,
  PointType,
  PlayerAgeCategory,
  ScoredPoint,
  Status,
  SyncOperation,
  SyncConflict,
  SyncMetadata,
  TennisSet,
  Tournament,
} from '../types';

export class TennisDatabase extends Dexie {
  families!: EntityTable<Family, 'id'>;
  family_members!: Table<FamilyMember, [string, string]>;
  family_invitations!: EntityTable<FamilyInvitation, 'id'>;
  players!: EntityTable<Player, 'id'>;
  clubs!: EntityTable<Club, 'id'>;
  tournaments!: EntityTable<Tournament, 'id'>;
  matches!: EntityTable<Match, 'id'>;
  sets!: EntityTable<TennisSet, 'id'>;
  games!: EntityTable<Game, 'id'>;
  points!: EntityTable<Point, 'id'>;
  point_types!: Table<PointType, number>;
  player_age_categories!: Table<PlayerAgeCategory, number>;
  statuses!: Table<Status, number>;
  fitp_rankings!: Table<FitpRanking, number>;
  syncQueue!: EntityTable<SyncOperation, 'id'>;
  syncMetadata!: EntityTable<SyncMetadata, 'key'>;
  syncConflicts!: EntityTable<SyncConflict, 'id'>;

  constructor(name = 'TennisKPITracker') {
    super(name);
    // Single schema version, aligned with supabase/initial_schema.sql. The number stays at 10 (the last version that
    // shipped with step-by-step migrations) because browsers refuse to open a database with a lower version than the
    // one already stored on the device. Each later schema change adds a new version with its own upgrade.
    // Booleans (points.won, points.serving, ...) are not valid IndexedDB keys, so they are stored but not indexed.
    this.version(10).stores({
      families: 'id, created_by, local_only, updated_at',
      family_members: '[family_id+user_id], family_id, user_id, role',
      family_invitations: 'id, family_id, invited_email, expires_at',
      players: 'id, family_id, first_name, last_name, ranking, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament, updated_at, deleted',
      sets: 'id, family_id, match_id, set_number, &[match_id+set_number], updated_at, deleted',
      games: 'id, family_id, set_id, game_number, &[set_id+game_number], updated_at, deleted',
      points: 'id, family_id, game_id, &[game_id+point_number], point_number, point_type_id, updated_at, deleted',
      point_types: 'id, &code',
      player_age_categories: 'id, &code, sector, sort_order',
      syncQueue: 'id, operation_id, family_id, entity_type, entity_id, created_at, attempts',
      syncMetadata: 'key, updated_at',
      syncConflicts: 'id, family_id, entity_type, entity_id, status, created_at',
    });
    // v11: clubs (family data, synchronized like players). Mirrors the clubs table in supabase/initial_schema.sql.
    this.version(11).stores({
      clubs: 'id, family_id, name, city, updated_at, deleted',
    });
    // v12: tournaments (family data, synchronized like clubs) and the matches.tournament_id foreign key, replacing the
    // free-text matches.tournament field, which is removed. Mirrors supabase/initial_schema.sql. Existing matches keep
    // tournament_id undefined (no tournament).
    this.version(12).stores({
      tournaments: 'id, family_id, club_id, start_date, updated_at, deleted',
      matches: 'id, family_id, match_date, player_id, status, tournament_id, updated_at, deleted',
    }).upgrade(transaction => transaction.table('matches').toCollection().modify(match => {
      delete (match as { tournament?: unknown }).tournament;
    }));
    // v13: tournaments.status (later replaced by status_id, v14).
    // Not indexed; tournaments stored before it existed (or with the earlier nullable status) become 'upcoming'.
    this.version(13).stores({}).upgrade(transaction => transaction.table('tournaments').toCollection().modify(tournament => {
      if (!['upcoming', 'in-progress', 'completed'].includes((tournament as { status?: unknown }).status as string)) {
        (tournament as { status: string }).status = 'upcoming';
      }
    }));
    // v14: the statuses reference table, shared by tournaments and matches, whose text status becomes status_id (FK to
    // statuses). Mirrors supabase/initial_schema.sql.
    this.version(14).stores({
      statuses: 'id, &code, sort_order',
      matches: 'id, family_id, match_date, player_id, status_id, tournament_id, updated_at, deleted',
    }).upgrade(async transaction => {
      await transaction.table('tournaments').toCollection().modify((tournament, ref) => {
        ref.value = migrateLegacyStatus('tournament', tournament);
      });
      await transaction.table('matches').toCollection().modify((match, ref) => {
        ref.value = migrateLegacyStatus('match', match);
      });
    });
    // v15: matches.third_set_type renamed last_set_type (it is the deciding set: the third or the fifth).
    // v16: matches.tiebreak_starts_at_363 removed; games_to_win_set, which replaces it, takes its value when missing.
    // Neither column is indexed. Both upgrades run the same idempotent conversion, so a device coming from v14 or v15
    // ends up the same.
    this.version(15).stores({}).upgrade(migrateLegacyMatchStores);
    this.version(16).stores({}).upgrade(migrateLegacyMatchStores);
    // v17: the fitp_rankings reference table; the free-text players.ranking becomes ranking_id (FK to fitp_rankings).
    // Mirrors supabase/initial_schema.sql. Texts that match no registry code become null.
    this.version(17).stores({
      fitp_rankings: 'id, &[season+code], category_group, sort_order',
      players: 'id, family_id, first_name, last_name, ranking_id, updated_at, deleted',
    }).upgrade(migrateLegacyPlayerStores);
    // v18: matches.player_ranking_snapshot (ranking code) becomes an FK to fitp_rankings, and the free-text
    // opponent_ranking becomes opponent_ranking_snapshot (FK too). Same idempotent conversion as v15/v16, which now
    // includes the rankings; codes that match no registry row become null. Neither column is indexed.
    this.version(18).stores({}).upgrade(migrateLegacyMatchStores);
    // v19: sets.status_id (FK to statuses: In programma, In corso, Concluso), computed from the points of each set.
    // Not indexed. Mirrors supabase/initial_schema.sql.
    this.version(19).stores({}).upgrade(async transaction => {
      const [matches, sets, games, points] = await Promise.all([
        transaction.table('matches').toArray(), transaction.table('sets').toArray(),
        transaction.table('games').toArray(), transaction.table('points').toArray(),
      ]);
      const statusById = new Map(withDerivedSetStatuses(matches, sets, games, points).map(set => [set.id, set.status_id]));
      await transaction.table('sets').toCollection().modify((set: TennisSet) => {
        set.status_id = statusById.get(set.id) ?? set.status_id ?? STATUS.upcoming;
      });
    });
    // v20: games.status_id (FK to statuses: In programma, In corso, Concluso), computed from the points of each game.
    // Not indexed. Mirrors supabase/initial_schema.sql.
    this.version(20).stores({}).upgrade(async transaction => {
      const [matches, sets, games, points] = await Promise.all([
        transaction.table('matches').toArray(), transaction.table('sets').toArray(),
        transaction.table('games').toArray(), transaction.table('points').toArray(),
      ]);
      const statusById = new Map(withDerivedGameStatuses(matches, sets, games, points).map(game => [game.id, game.status_id]));
      await transaction.table('games').toCollection().modify((game: Game) => {
        game.status_id = statusById.get(game.id) ?? game.status_id ?? STATUS.upcoming;
      });
    });
    // Reference tables are written every time the database opens, whatever version the device came from.
    this.on('ready', database => seedReferenceTables(database as TennisDatabase));
  }
}

/** Converts the legacy match columns in stored matches and in the match records carried by pending sync operations
 *  and conflicts: an unsent upsert with a removed or renamed column would be rejected by Supabase. */
async function migrateLegacyMatchStores(transaction: Transaction): Promise<void> {
  await transaction.table('matches').toCollection().modify((match, ref) => {
    ref.value = migrateLegacyMatchColumns(match);
  });
  await transaction.table('syncQueue').toCollection().modify((operation: SyncOperation) => {
    if (operation.entity_type === 'matches') operation.payload = migrateLegacyMatchColumns(operation.payload);
  });
  await transaction.table('syncConflicts').toCollection().modify((conflict: SyncConflict) => {
    if (conflict.entity_type !== 'matches') return;
    conflict.local_payload = migrateLegacyMatchColumns(conflict.local_payload);
    conflict.remote_payload = migrateLegacyMatchColumns(conflict.remote_payload);
  });
}

/** Converts the free-text ranking of stored players, and of the player records carried by pending sync operations and
 *  conflicts, to ranking_id: an unsent upsert with the removed column would lose the ranking on Supabase. */
async function migrateLegacyPlayerStores(transaction: Transaction): Promise<void> {
  await transaction.table('players').toCollection().modify((player, ref) => {
    ref.value = migrateLegacyPlayerRanking(player);
  });
  await transaction.table('syncQueue').toCollection().modify((operation: SyncOperation) => {
    if (operation.entity_type === 'players') operation.payload = migrateLegacyPlayerRanking(operation.payload);
  });
  await transaction.table('syncConflicts').toCollection().modify((conflict: SyncConflict) => {
    if (conflict.entity_type !== 'players') return;
    conflict.local_payload = migrateLegacyPlayerRanking(conflict.local_payload);
    conflict.remote_payload = migrateLegacyPlayerRanking(conflict.remote_payload);
  });
}

/** Writes the reference tables (same rows as supabase/initial_schema.sql). Idempotent: rows are keyed by their stable
 *  id, so running it at every start updates them instead of creating duplicates. */
function seedReferenceTables(database: TennisDatabase): Promise<unknown> {
  return database.transaction('rw', [
    database.point_types, database.player_age_categories, database.statuses, database.fitp_rankings,
  ], () => Promise.all([
    database.point_types.bulkPut([...POINT_TYPES]),
    database.player_age_categories.bulkPut([...PLAYER_AGE_CATEGORIES]),
    database.statuses.bulkPut([...STATUSES]),
    database.fitp_rankings.bulkPut([...FITP_RANKINGS]),
  ]));
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

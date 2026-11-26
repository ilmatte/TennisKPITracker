import { db } from './database';
import type {
  Club,
  Game,
  Match,
  Player,
  Point,
  ScoredPoint,
  SyncOperation,
  TennisSet,
} from '../types';
import { deriveSetScore } from '../features/scoring/scoring';

const timestamp = () => new Date().toISOString();

function queueOperation<T extends { id: string }>(
  family_id: string,
  entity_type: SyncOperation['entity_type'],
  entity: T,
  created_at: string,
): SyncOperation {
  const operationId = crypto.randomUUID();
  return {
    id: operationId,
    operation_id: operationId,
    family_id,
    entity_type,
    entity_id: entity.id,
    operation: 'upsert',
    payload: entity,
    created_at,
    attempts: 0,
  };
}

function updated<T extends { updated_at: string; version: number }>(record: T, updated_at: string): T {
  return { ...record, updated_at, version: record.version + 1 };
}

async function write<T extends { id: string; family_id: string }>(
  store: { put: (record: T) => Promise<unknown> },
  entity_type: SyncOperation['entity_type'],
  record: T,
  updated_at: string,
): Promise<void> {
  await store.put(record);
  await db.syncQueue.put(queueOperation(record.family_id, entity_type, record, updated_at));
}

async function requireActive<T extends { id: string; family_id: string; deleted: boolean }>(
  get: (id: string) => Promise<T | undefined>,
  id: string,
  familyId: string,
  label: string,
): Promise<T> {
  const record = await get(id);
  if (!record || record.family_id !== familyId || record.deleted) {
    throw new Error(`${label} non trovato nello spazio attivo.`);
  }
  return record;
}

async function readScoredPoints(match: Match): Promise<ScoredPoint[]> {
  const sets = await db.sets.where('family_id').equals(match.family_id)
    .filter(set => set.match_id === match.id && !set.deleted).toArray();
  const setIds = new Set(sets.map(set => set.id));
  const games = await db.games.where('family_id').equals(match.family_id)
    .filter(game => setIds.has(game.set_id) && !game.deleted).toArray();
  const gameIds = new Set(games.map(game => game.id));
  const points = gameIds.size ? await db.points.where('game_id').anyOf([...gameIds]).toArray() : [];
  const setById = new Map(sets.map(set => [set.id, set]));
  const gameById = new Map(games.map(game => [game.id, game]));
  return points.flatMap(point => {
    const game = gameById.get(point.game_id);
    const set = game ? setById.get(game.set_id) : undefined;
    if (!game || !set || point.family_id !== match.family_id) return [];
    return [{ ...point, set_number: set.set_number, game_number: game.game_number }];
  });
}

async function recalculate(match: Match, updated_at: string): Promise<void> {
  const points = await readScoredPoints(match);
  const sets = await db.sets.where('family_id').equals(match.family_id)
    .filter(set => set.match_id === match.id && !set.deleted).toArray();
  const setIds = new Set(sets.map(set => set.id));
  const games = await db.games.where('family_id').equals(match.family_id)
    .filter(game => setIds.has(game.set_id) && !game.deleted).toArray();

  for (const game of games) {
    const gamePoints = points.filter(point => point.game_id === game.id && !point.deleted);
    const next: Game = {
      ...game,
      player_points: gamePoints.filter(point => point.won).length,
      opponent_points: gamePoints.filter(point => !point.won).length,
    };
    if (next.player_points !== game.player_points || next.opponent_points !== game.opponent_points) {
      await write(db.games, 'games', updated(next, updated_at), updated_at);
    }
  }

  for (const set of sets) {
    const score = deriveSetScore(points, set.set_number, match);
    if (score.player !== set.player_games || score.opponent !== set.opponent_games) {
      await write(db.sets, 'sets', {
        ...updated(set, updated_at),
        player_games: score.player,
        opponent_games: score.opponent,
      }, updated_at);
    }
  }
}

export async function createPlayer(player: Player, userId: string | null): Promise<void> {
  await db.transaction('rw', [db.families, db.family_members, db.players, db.syncQueue], async () => {
    const family = await db.families.get(player.family_id);
    if (!family) throw new Error('La famiglia indicata non esiste.');

    const authorized = family.local_only ||
      (userId !== null && Boolean(await db.family_members.get([family.id, userId])));
    if (!authorized) throw new Error('Non sei autorizzato a creare giocatori in questa famiglia.');

    const created = { ...player, version: 1, deleted: false };
    await db.players.add(created);
    await db.syncQueue.add(queueOperation(created.family_id, 'players', created, created.created_at));
  });
}

export async function updatePlayer(
  familyId: string,
  id: string,
  changes: Pick<Player, 'first_name' | 'last_name' | 'birth_date' | 'ranking'>,
): Promise<Player> {
  return db.transaction('rw', [db.players, db.syncQueue], async () => {
    const current = await requireActive(id => db.players.get(id), id, familyId, 'Giocatore');
    const next = { ...updated(current, timestamp()), ...changes };
    await write(db.players, 'players', next, next.updated_at);
    return next;
  });
}

export type MatchChanges = Pick<Match,
  'match_date' | 'player_id' | 'opponent' | 'opponent_ranking' |
  'tournament' | 'tournament_match_number' | 'number_of_sets' | 'third_set_type' |
  'super_tiebreak_target' | 'tiebreak_target' | 'games_to_win_set' | 'short_set_tiebreak_at' | 'tiebreak_starts_at_363' |
  'deuce_single_point' | 'first_server' | 'status' | 'result'
>;

export async function updateMatch(
  familyId: string,
  id: string,
  changes: MatchChanges,
): Promise<Match> {
  return db.transaction('rw', [db.players, db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const current = await requireActive(id => db.matches.get(id), id, familyId, 'Partita');
    const player = changes.player_id === current.player_id
      ? undefined
      : await requireActive(id => db.players.get(id), changes.player_id, familyId, 'Giocatore');
    const sets = await db.sets.where('family_id').equals(familyId)
      .filter(set => set.match_id === id && !set.deleted).toArray();
    if (![3, 5].includes(changes.number_of_sets) || sets.some(set => set.set_number > changes.number_of_sets)) {
      throw new Error('Il numero di set non può essere ridotto sotto un set già registrato.');
    }
    if (changes.tiebreak_target < 1 || changes.super_tiebreak_target < 1) {
      throw new Error('I target dei tie-break devono essere maggiori di zero.');
    }
    const gamesToWinSet = changes.games_to_win_set ?? (changes.tiebreak_starts_at_363 ? 4 : 6);
    const shortSetTiebreakAt = changes.short_set_tiebreak_at ?? current.short_set_tiebreak_at ?? 3;
    if (gamesToWinSet !== 4 && gamesToWinSet !== 6) {
      throw new Error('Il set deve essere impostato a 4 o 6 game.');
    }
    if (gamesToWinSet === 4 && shortSetTiebreakAt !== 3 && shortSetTiebreakAt !== 4) {
      throw new Error('Il tie-break dei set a 4 game deve iniziare sul 3-3 o sul 4-4.');
    }
    const next: Match = {
      ...updated(current, timestamp()),
      ...changes,
      games_to_win_set: gamesToWinSet,
      short_set_tiebreak_at: shortSetTiebreakAt,
      tiebreak_starts_at_363: gamesToWinSet === 4,
      ...(player ? { player_ranking_snapshot: player.ranking } : {}),
    };
    await write(db.matches, 'matches', next, next.updated_at);
    await recalculate(next, next.updated_at);
    return next;
  });
}

export async function updateSet(
  familyId: string,
  id: string,
  changes: Pick<TennisSet, 'set_number'>,
): Promise<TennisSet> {
  return db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const current = await requireActive(id => db.sets.get(id), id, familyId, 'Set');
    const match = await requireActive(id => db.matches.get(id), current.match_id, familyId, 'Partita');
    if (!Number.isInteger(changes.set_number) || changes.set_number < 1 || changes.set_number > match.number_of_sets) {
      throw new Error('Il numero del set deve rientrare nel formato della partita.');
    }
    const next = { ...updated(current, timestamp()), ...changes };
    await write(db.sets, 'sets', next, next.updated_at);
    await recalculate(match, next.updated_at);
    return next;
  });
}

export async function updateGame(
  familyId: string,
  id: string,
  changes: Pick<Game, 'game_number'>,
): Promise<Game> {
  return db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const current = await requireActive(id => db.games.get(id), id, familyId, 'Game');
    const set = await requireActive(id => db.sets.get(id), current.set_id, familyId, 'Set');
    const match = await requireActive(id => db.matches.get(id), set.match_id, familyId, 'Partita');
    if (!Number.isInteger(changes.game_number) || changes.game_number < 1) {
      throw new Error('Il numero del game deve essere un intero positivo.');
    }
    const next = { ...updated(current, timestamp()), ...changes };
    await write(db.games, 'games', next, next.updated_at);
    await recalculate(match, next.updated_at);
    return next;
  });
}

export type PointChanges = Pick<Point,
  'won' | 'serving' | 'second_serve' | 'point_type_id' | 'shot_count'
>;

export async function updatePoint(
  familyId: string,
  id: string,
  changes: PointChanges,
): Promise<Point> {
  return db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const current = await requireActive(id => db.points.get(id), id, familyId, 'Punto');
    const game = await requireActive(id => db.games.get(id), current.game_id, familyId, 'Game');
    const set = await requireActive(id => db.sets.get(id), game.set_id, familyId, 'Set');
    const match = await requireActive(id => db.matches.get(id), set.match_id, familyId, 'Partita');
    if (!Number.isInteger(changes.shot_count) || changes.shot_count < 1) {
      throw new Error('Il numero di colpi deve essere un intero positivo.');
    }
    const next = { ...updated(current, timestamp()), ...changes };
    await write(db.points, 'points', next, next.updated_at);
    await recalculate(match, next.updated_at);
    return next;
  });
}

export async function countMatchDescendants(familyId: string, matchId: string) {
  const sets = await db.sets.where('family_id').equals(familyId)
    .filter(set => set.match_id === matchId && !set.deleted).toArray();
  const setIds = new Set(sets.map(set => set.id));
  const games = await db.games.where('family_id').equals(familyId)
    .filter(game => setIds.has(game.set_id) && !game.deleted).toArray();
  const gameIds = new Set(games.map(game => game.id));
  const points = gameIds.size
    ? (await db.points.where('game_id').anyOf([...gameIds]).toArray())
      .filter(point => point.family_id === familyId && !point.deleted)
    : [];
  return { sets: sets.length, games: games.length, points: points.length };
}

export async function countSetDescendants(familyId: string, setId: string) {
  const games = await db.games.where('family_id').equals(familyId)
    .filter(game => game.set_id === setId && !game.deleted).toArray();
  const gameIds = new Set(games.map(game => game.id));
  const points = gameIds.size
    ? (await db.points.where('game_id').anyOf([...gameIds]).toArray())
      .filter(point => point.family_id === familyId && !point.deleted)
    : [];
  return { games: games.length, points: points.length };
}

export async function countGameDescendants(familyId: string, gameId: string) {
  return (await db.points.where('game_id').equals(gameId).toArray())
    .filter(point => point.family_id === familyId && !point.deleted).length;
}

async function tombstone<T extends { id: string; family_id: string; deleted: boolean; updated_at: string; version: number }>(
  store: { put: (record: T) => Promise<unknown> },
  entity_type: SyncOperation['entity_type'],
  record: T,
  updated_at: string,
): Promise<T> {
  const next = { ...updated(record, updated_at), deleted: true };
  await write(store, entity_type, next, updated_at);
  return next;
}

export async function softDeletePlayer(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.players, db.syncQueue], async () => {
    const player = await requireActive(id => db.players.get(id), id, familyId, 'Giocatore');
    await tombstone(db.players, 'players', player, timestamp());
  });
}

export type ClubChanges = Pick<Club, 'name' | 'city' | 'surface'>;

function validClub(changes: ClubChanges): ClubChanges {
  const name = changes.name.trim();
  if (!name) throw new Error('Il nome del club è obbligatorio.');
  return { name, city: changes.city.trim(), surface: changes.surface };
}

export async function createClub(familyId: string, changes: ClubChanges): Promise<Club> {
  return db.transaction('rw', [db.families, db.clubs, db.syncQueue], async () => {
    if (!await db.families.get(familyId)) throw new Error('La famiglia indicata non esiste.');
    const created_at = timestamp();
    const club: Club = {
      id: crypto.randomUUID(), family_id: familyId, ...validClub(changes),
      created_at, updated_at: created_at, version: 1, deleted: false,
    };
    await db.clubs.add(club);
    await db.syncQueue.add(queueOperation(familyId, 'clubs', club, created_at));
    return club;
  });
}

export async function updateClub(familyId: string, id: string, changes: ClubChanges): Promise<Club> {
  return db.transaction('rw', [db.clubs, db.syncQueue], async () => {
    const current = await requireActive(id => db.clubs.get(id), id, familyId, 'Club');
    const next = { ...updated(current, timestamp()), ...validClub(changes) };
    await write(db.clubs, 'clubs', next, next.updated_at);
    return next;
  });
}

export async function softDeleteClub(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.clubs, db.syncQueue], async () => {
    const club = await requireActive(id => db.clubs.get(id), id, familyId, 'Club');
    await tombstone(db.clubs, 'clubs', club, timestamp());
  });
}

export async function softDeleteMatch(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const match = await requireActive(id => db.matches.get(id), id, familyId, 'Partita');
    const updated_at = timestamp();
    const sets = await db.sets.where('family_id').equals(familyId)
      .filter(set => set.match_id === id && !set.deleted).toArray();
    const setIds = new Set(sets.map(set => set.id));
    const games = await db.games.where('family_id').equals(familyId)
      .filter(game => setIds.has(game.set_id) && !game.deleted).toArray();
    const gameIds = new Set(games.map(game => game.id));
    const points = gameIds.size
      ? (await db.points.where('game_id').anyOf([...gameIds]).toArray())
        .filter(point => point.family_id === familyId && !point.deleted)
      : [];
    await tombstone(db.matches, 'matches', match, updated_at);
    for (const set of sets) await tombstone(db.sets, 'sets', set, updated_at);
    for (const game of games) await tombstone(db.games, 'games', game, updated_at);
    for (const point of points) await tombstone(db.points, 'points', point, updated_at);
  });
}

export async function softDeleteSet(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const set = await requireActive(id => db.sets.get(id), id, familyId, 'Set');
    await requireActive(id => db.matches.get(id), set.match_id, familyId, 'Partita');
    const updated_at = timestamp();
    const games = await db.games.where('family_id').equals(familyId)
      .filter(game => game.set_id === id && !game.deleted).toArray();
    const gameIds = new Set(games.map(game => game.id));
    const points = gameIds.size
      ? (await db.points.where('game_id').anyOf([...gameIds]).toArray())
        .filter(point => point.family_id === familyId && !point.deleted)
      : [];
    await tombstone(db.sets, 'sets', set, updated_at);
    for (const game of games) await tombstone(db.games, 'games', game, updated_at);
    for (const point of points) await tombstone(db.points, 'points', point, updated_at);
  });
}

export async function softDeleteGame(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const game = await requireActive(id => db.games.get(id), id, familyId, 'Game');
    const set = await requireActive(id => db.sets.get(id), game.set_id, familyId, 'Set');
    const match = await requireActive(id => db.matches.get(id), set.match_id, familyId, 'Partita');
    const updated_at = timestamp();
    const points = (await db.points.where('game_id').equals(id).toArray())
      .filter(point => point.family_id === familyId && !point.deleted);
    await tombstone(db.games, 'games', game, updated_at);
    for (const point of points) await tombstone(db.points, 'points', point, updated_at);
    await recalculate(match, updated_at);
  });
}

export async function softDeletePoint(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const point = await requireActive(id => db.points.get(id), id, familyId, 'Punto');
    const game = await requireActive(id => db.games.get(id), point.game_id, familyId, 'Game');
    const set = await requireActive(id => db.sets.get(id), game.set_id, familyId, 'Set');
    const match = await requireActive(id => db.matches.get(id), set.match_id, familyId, 'Partita');
    const updated_at = timestamp();
    await tombstone(db.points, 'points', point, updated_at);
    await recalculate(match, updated_at);
  });
}

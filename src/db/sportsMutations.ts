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
  Tournament,
  TournamentStatusId,
} from '../types';
import { deriveSetScore, deriveSetStatusId } from '../features/scoring/scoring';
import { TOURNAMENT_CATEGORIES } from '../features/tournaments/tournaments';
import { STATUS, isMatchStatusId, isTournamentStatusId } from '../features/statuses/statuses';
import { withStatusTiming } from '../features/matches/matchTime';

const timestamp = () => new Date().toISOString();

/** Ranking of a player, normalized: null when not specified. A value must be a row of the fitp_rankings reference table
 *  (same integrity as the Supabase players_ranking_id_fkey). Call inside a transaction that includes db.fitp_rankings. */
async function requireRankingId(rankingId: number | null | undefined): Promise<number | null> {
  if (rankingId === null || rankingId === undefined) return null;
  if (!Number.isInteger(rankingId) || !(await db.fitp_rankings.get(rankingId))) {
    throw new Error('Classifica FITP non valida.');
  }
  return rankingId;
}

/** The player's current ranking, frozen in a match as player_ranking_snapshot (FK to fitp_rankings). */
async function rankingSnapshot(player: Player): Promise<number | null> {
  return requireRankingId(player.ranking_id);
}

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

  // Score and status of every set follow its points: a set whose points are all deleted goes back to In programma.
  for (const set of sets) {
    const score = deriveSetScore(points, set.set_number, match);
    const status_id = deriveSetStatusId(points, set.set_number, match);
    if (score.player !== set.player_games || score.opponent !== set.opponent_games || status_id !== set.status_id) {
      await write(db.sets, 'sets', {
        ...updated(set, updated_at),
        player_games: score.player,
        opponent_games: score.opponent,
        status_id,
      }, updated_at);
    }
  }
}

export async function createPlayer(player: Player, userId: string | null): Promise<void> {
  await db.transaction('rw', [db.families, db.family_members, db.players, db.fitp_rankings, db.syncQueue], async () => {
    const family = await db.families.get(player.family_id);
    if (!family) throw new Error('La famiglia indicata non esiste.');

    const authorized = family.local_only ||
      (userId !== null && Boolean(await db.family_members.get([family.id, userId])));
    if (!authorized) throw new Error('Non sei autorizzato a creare giocatori in questa famiglia.');

    const created = { ...player, ranking_id: await requireRankingId(player.ranking_id), version: 1, deleted: false };
    await db.players.add(created);
    await db.syncQueue.add(queueOperation(created.family_id, 'players', created, created.created_at));
  });
}

export async function updatePlayer(
  familyId: string,
  id: string,
  changes: Pick<Player, 'first_name' | 'last_name' | 'birth_date' | 'ranking_id'>,
): Promise<Player> {
  // Matches already registered keep their player_ranking_snapshot: only the player's current ranking changes.
  return db.transaction('rw', [db.players, db.fitp_rankings, db.syncQueue], async () => {
    const current = await requireActive(id => db.players.get(id), id, familyId, 'Giocatore');
    const next = { ...updated(current, timestamp()), ...changes, ranking_id: await requireRankingId(changes.ranking_id) };
    await write(db.players, 'players', next, next.updated_at);
    return next;
  });
}

export type MatchChanges = Pick<Match,
  'match_date' | 'player_id' | 'opponent' | 'opponent_ranking_snapshot' |
  'tournament_id' | 'tournament_match_number' | 'number_of_sets' | 'last_set_type' |
  'super_tiebreak_target' | 'tiebreak_target' | 'games_to_win_set' | 'short_set_tiebreak_at' |
  'deuce_single_point' | 'first_server' | 'status_id' | 'result'
>;

export async function updateMatch(
  familyId: string,
  id: string,
  changes: MatchChanges,
): Promise<Match> {
  return db.transaction('rw', [db.players, db.fitp_rankings, db.tournaments, db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
    const current = await requireActive(id => db.matches.get(id), id, familyId, 'Partita');
    const player = changes.player_id === current.player_id
      ? undefined
      : await requireActive(id => db.players.get(id), changes.player_id, familyId, 'Giocatore');
    // A deleted tournament already linked to the match may stay; a newly chosen one must be active in the family.
    if (changes.tournament_id && changes.tournament_id !== current.tournament_id) {
      await requireActive(id => db.tournaments.get(id), changes.tournament_id, familyId, 'Torneo');
    }
    const sets = await db.sets.where('family_id').equals(familyId)
      .filter(set => set.match_id === id && !set.deleted).toArray();
    if (![3, 5].includes(changes.number_of_sets) || sets.some(set => set.set_number > changes.number_of_sets)) {
      throw new Error('Il numero di set non può essere ridotto sotto un set già registrato.');
    }
    if (changes.tiebreak_target < 1 || changes.super_tiebreak_target < 1) {
      throw new Error('I target dei tie-break devono essere maggiori di zero.');
    }
    if (!isMatchStatusId(changes.status_id)) throw new Error('Stato della partita non valido.');
    const gamesToWinSet = changes.games_to_win_set;
    const shortSetTiebreakAt = changes.short_set_tiebreak_at ?? current.short_set_tiebreak_at ?? 3;
    if (gamesToWinSet !== 4 && gamesToWinSet !== 6) {
      throw new Error('Il set deve essere impostato a 4 o 6 game.');
    }
    if (gamesToWinSet === 4 && shortSetTiebreakAt !== 3 && shortSetTiebreakAt !== 4) {
      throw new Error('Il tie-break dei set a 4 game deve iniziare sul 3-3 o sul 4-4.');
    }
    const now = timestamp();
    const next: Match = withStatusTiming(current, {
      ...updated(current, now),
      ...changes,
      games_to_win_set: gamesToWinSet,
      short_set_tiebreak_at: shortSetTiebreakAt,
      opponent_ranking_snapshot: await requireRankingId(changes.opponent_ranking_snapshot),
      // Only a different player gets a new snapshot; otherwise the historical ranking is kept.
      ...(player ? { player_ranking_snapshot: await rankingSnapshot(player) } : {}),
    }, now);
    await write(db.matches, 'matches', next, next.updated_at);
    await recalculate(next, next.updated_at);
    return next;
  });
}

/** Fields of a new match chosen in the "Nuova partita" wizard. The player's ranking snapshot is taken from the player;
 *  the opponent's one is chosen in the wizard (FK to fitp_rankings, optional). */
export type NewMatchInput = Pick<Match,
  'match_date' | 'player_id' | 'opponent' | 'opponent_ranking_snapshot' | 'number_of_sets' | 'last_set_type' | 'super_tiebreak_target' |
  'tiebreak_target' | 'games_to_win_set' | 'short_set_tiebreak_at' | 'deuce_single_point' | 'first_server'
> & { tournament_id: string };

export async function createMatch(familyId: string, input: NewMatchInput): Promise<Match> {
  return db.transaction('rw', [db.players, db.fitp_rankings, db.tournaments, db.matches, db.syncQueue], async () => {
    const player = await requireActive(id => db.players.get(id), input.player_id, familyId, 'Giocatore');
    await requireActive(id => db.tournaments.get(id), input.tournament_id, familyId, 'Torneo');
    const opponent = input.opponent.trim();
    if (!opponent) throw new Error("Il nome dell'avversario è obbligatorio.");
    if (input.tiebreak_target < 1 || input.super_tiebreak_target < 1) {
      throw new Error('I target dei tie-break devono essere maggiori di zero.');
    }
    const gamesToWinSet = input.games_to_win_set;
    if (gamesToWinSet !== 4 && gamesToWinSet !== 6) {
      throw new Error('Il set deve essere impostato a 4 o 6 game.');
    }
    const created_at = timestamp();
    const match: Match = {
      ...input,
      id: crypto.randomUUID(),
      family_id: familyId,
      opponent,
      player_ranking_snapshot: await rankingSnapshot(player),
      opponent_ranking_snapshot: await requireRankingId(input.opponent_ranking_snapshot),
      games_to_win_set: gamesToWinSet,
      short_set_tiebreak_at: input.short_set_tiebreak_at ?? 3,
      status_id: STATUS.in_progress,
      created_at,
      updated_at: created_at,
      version: 1,
      deleted: false,
    };
    await db.matches.add(match);
    await db.syncQueue.add(queueOperation(familyId, 'matches', match, created_at));
    return match;
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

export type TournamentChanges = Pick<Tournament, 'name' | 'age_category_id' | 'start_date'>;

/** The hosting club: an existing one, or a new one created together with the tournament. */
export type TournamentClub = { id: string } | { create: ClubChanges };

function validTournament(changes: TournamentChanges): TournamentChanges {
  const name = changes.name.trim();
  if (!name) throw new Error('Il nome del torneo è obbligatorio.');
  if (!TOURNAMENT_CATEGORIES.some(category => category.id === changes.age_category_id)) {
    throw new Error('Categoria del torneo non valida.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.start_date) || Number.isNaN(Date.parse(changes.start_date))) {
    throw new Error('La data di inizio del torneo non è valida.');
  }
  return { name, age_category_id: changes.age_category_id, start_date: changes.start_date };
}

/** Creates a tournament, and its club too when `club` asks for a new one: both are written in one transaction, so a
 *  failure leaves neither behind. */
export async function createTournament(
  familyId: string,
  changes: TournamentChanges,
  club: TournamentClub,
): Promise<{ tournament: Tournament; club: Club }> {
  return db.transaction('rw', [db.families, db.clubs, db.tournaments, db.syncQueue], async () => {
    if (!await db.families.get(familyId)) throw new Error('La famiglia indicata non esiste.');
    const valid = validTournament(changes);
    const host = 'create' in club
      ? await createClub(familyId, club.create)
      : await requireActive(id => db.clubs.get(id), club.id, familyId, 'Club');
    const created_at = timestamp();
    const tournament: Tournament = {
      id: crypto.randomUUID(), family_id: familyId, club_id: host.id, ...valid, status_id: STATUS.upcoming,
      created_at, updated_at: created_at, version: 1, deleted: false,
    };
    await db.tournaments.add(tournament);
    await db.syncQueue.add(queueOperation(familyId, 'tournaments', tournament, created_at));
    return { tournament, club: host };
  });
}

/** Updates a tournament; like createTournament, `club` may ask for a new club, created in the same transaction. The
 *  tournament may keep its current club even if that club has since been deleted; a newly chosen one must be active. */
export async function updateTournament(
  familyId: string,
  id: string,
  changes: TournamentChanges,
  club: TournamentClub,
): Promise<{ tournament: Tournament; club: Club }> {
  return db.transaction('rw', [db.families, db.clubs, db.tournaments, db.syncQueue], async () => {
    const current = await requireActive(id => db.tournaments.get(id), id, familyId, 'Torneo');
    const valid = validTournament(changes);
    let host: Club;
    if ('create' in club) host = await createClub(familyId, club.create);
    else if (club.id === current.club_id) {
      const existing = await db.clubs.get(club.id);
      if (!existing || existing.family_id !== familyId) throw new Error('Club non trovato nello spazio attivo.');
      host = existing;
    } else host = await requireActive(id => db.clubs.get(id), club.id, familyId, 'Club');
    const next: Tournament = { ...updated(current, timestamp()), ...valid, club_id: host.id };
    await write(db.tournaments, 'tournaments', next, next.updated_at);
    return { tournament: next, club: host };
  });
}

/** Changes the status of a tournament: it is created In programma and changes only through this function. */
export async function setTournamentStatus(familyId: string, id: string, statusId: TournamentStatusId): Promise<Tournament> {
  if (!isTournamentStatusId(statusId)) throw new Error('Stato del torneo non valido.');
  return db.transaction('rw', [db.tournaments, db.syncQueue], async () => {
    const current = await requireActive(id => db.tournaments.get(id), id, familyId, 'Torneo');
    if (current.status_id === statusId) return current;
    const next: Tournament = { ...updated(current, timestamp()), status_id: statusId };
    await write(db.tournaments, 'tournaments', next, next.updated_at);
    return next;
  });
}

/** Deletes a tournament logically (tombstone synchronized like the other records). Its matches are kept and still
 *  point to it, so they show their tournament as deleted. */
export async function softDeleteTournament(familyId: string, id: string): Promise<void> {
  await db.transaction('rw', [db.tournaments, db.syncQueue], async () => {
    const tournament = await requireActive(id => db.tournaments.get(id), id, familyId, 'Torneo');
    await tombstone(db.tournaments, 'tournaments', tournament, timestamp());
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

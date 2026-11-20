import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getMatchPoints } from './database';
import {
  createPlayer,
  softDeleteGame,
  softDeleteMatch,
  softDeletePlayer,
  softDeletePoint,
  softDeleteSet,
  updateGame,
  updateMatch,
  updatePlayer,
  updatePoint,
  updateSet,
  type MatchChanges,
  type PointChanges,
} from './sportsMutations';
import { serveKpi } from '../features/kpi/kpi';
import { configuredSetNavigation } from '../features/scoring/scoring';
import type { Game, Match, Player, Point, TennisSet } from '../types';

const now = '2026-01-01T10:00:00.000Z';

function family(id: string, local_only = true, created_by: string | null = null) {
  return { id, name: id, created_at: now, updated_at: now, created_by, local_only };
}

function player(id: string, family_id = 'family-1'): Player {
  return {
    id, family_id, first_name: 'Ada', last_name: 'Lovelace', birth_date: null,
    category: 'U16', ranking: '4.1', created_at: now, updated_at: now, version: 1, deleted: false,
  };
}

function match(id = 'match-1', family_id = 'family-1', player_id = 'player-1'): Match {
  return {
    id, family_id, match_date: '2026-01-01', player_id,
    player_first_name_snapshot: 'Ada', player_last_name_snapshot: 'Lovelace',
    player_ranking_snapshot: '4.1', player_category_snapshot: 'U16',
    opponent: 'Bea', opponent_ranking: '3.5', opponent_category: 'U18', tournament: 'Open',
    tournament_match_number: 4, number_of_sets: 3, third_set_type: 'normal',
    super_tiebreak_target: 10, tiebreak_target: 7, tiebreak_starts_at_363: true,
    deuce_single_point: false, first_server: 'player', status: 'in-progress', result: null,
    created_at: now, updated_at: now, version: 1, deleted: false,
  };
}

function tennisSet(id: string, set_number = 1): TennisSet {
  return {
    id, family_id: 'family-1', match_id: 'match-1', set_number,
    player_games: 1, opponent_games: 0, created_at: now, updated_at: now, version: 1, deleted: false,
  };
}

function tennisGame(id: string, set_id = 'set-1', game_number = 1): Game {
  return {
    id, family_id: 'family-1', set_id, game_number,
    player_points: 4, opponent_points: 0, created_at: now, updated_at: now, version: 1, deleted: false,
  };
}

function point(id: string, point_number: number): Point {
  return {
    id, family_id: 'family-1', game_id: 'game-1', point_number, winner: 'player', server: 'player',
    second_serve: false, double_fault: false, shot_count: 3, free_error: false, error_player: undefined,
    error_category: undefined, attack_error: false, pressure_situation: false, pressure_error_player: undefined,
    created_at: now, updated_at: now, version: 1, deleted: false,
  };
}

async function seedMatch(withPoints = false) {
  await db.players.bulkAdd([player('player-1'), player('player-2'), player('other-family', 'family-2')]);
  await db.matches.add(match());
  await db.sets.add(tennisSet('set-1'));
  await db.games.add(tennisGame('game-1'));
  if (withPoints) await db.points.bulkAdd([1, 2, 3, 4].map(number => point(`point-${number}`, number)));
}

async function operations(entity_id: string) {
  return (await db.syncQueue.toArray()).filter(operation => operation.entity_id === entity_id);
}

beforeEach(async () => {
  await db.transaction('rw', [
    db.families, db.family_members, db.players, db.matches, db.sets, db.games, db.points, db.syncQueue,
  ], async () => {
    await Promise.all([
      db.families.clear(), db.family_members.clear(), db.players.clear(), db.matches.clear(),
      db.sets.clear(), db.games.clear(), db.points.clear(), db.syncQueue.clear(),
    ]);
  });
});

describe('sport entity mutations', () => {
  it('creates players at version 1 and queues an upsert', async () => {
    await db.families.add(family('family-1'));
    const newPlayer = { ...player('new-player'), version: 0 };
    await createPlayer(newPlayer, null);

    const stored = await db.players.get(newPlayer.id);
    expect(stored).toMatchObject({ version: 1, deleted: false });
    expect(await operations(newPlayer.id)).toMatchObject([
      { operation: 'upsert', payload: { id: newPlayer.id, version: 1 } },
    ]);
  });

  it('rejects player creation for a missing family', async () => {
    await expect(createPlayer(player('new-player'), null)).rejects.toThrow('La famiglia indicata non esiste.');
    expect(await db.players.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('allows local player creation regardless of the current login without claiming the workspace', async () => {
    await db.families.add(family('family-1', true, 'owner-1'));
    await createPlayer(player('new-player'), 'user-2');

    expect(await db.players.get('new-player')).toMatchObject({ family_id: 'family-1' });
    expect(await db.families.get('family-1')).toMatchObject({ local_only: true, created_by: 'owner-1' });
    expect(await db.syncQueue.count()).toBe(1);
  });

  it('rejects player creation for a shared family without a local membership', async () => {
    await db.families.add(family('shared-family', false, 'owner-1'));
    await expect(createPlayer(player('new-player', 'shared-family'), 'user-2'))
      .rejects.toThrow('Non sei autorizzato a creare giocatori in questa famiglia.');
    expect(await db.players.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('allows the recorded local-family owner and a recorded shared-family member', async () => {
    await db.families.bulkAdd([
      family('owned-local', true, 'user-1'),
      family('shared-family', false, 'creator-1'),
    ]);
    await db.family_members.add({
      family_id: 'shared-family', user_id: 'user-2', member_email: 'user@example.test',
      role: 'member', created_at: now,
    });

    await createPlayer(player('local-player', 'owned-local'), 'user-1');
    await createPlayer(player('shared-player', 'shared-family'), 'user-2');
    expect(await db.players.count()).toBe(2);
    expect(await db.syncQueue.count()).toBe(2);
  });

  it('rolls back player creation when the queue write fails', async () => {
    await db.families.add(family('family-1'));
    const queueWrite = vi.spyOn(db.syncQueue, 'add').mockImplementation(() =>
      new Dexie.Promise<string>((_resolve, reject) => reject(new Error('simulated queue failure'))));
    try {
      await expect(createPlayer(player('new-player'), null)).rejects.toThrow('simulated queue failure');
    } finally {
      queueWrite.mockRestore();
    }

    expect(await db.players.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('updates player profile without changing historical match snapshots', async () => {
    await seedMatch();
    const saved = await updatePlayer('family-1', 'player-1', {
      first_name: 'Ada Marie', last_name: 'Byron', birth_date: '1815-12-10', category: 'Open', ranking: '3.1',
    });

    expect(saved).toMatchObject({ version: 2, updated_at: expect.not.stringMatching(now) });
    expect(await db.matches.get('match-1')).toMatchObject({
      player_first_name_snapshot: 'Ada', player_last_name_snapshot: 'Lovelace',
      player_ranking_snapshot: '4.1', player_category_snapshot: 'U16',
    });
    expect(await operations('player-1')).toMatchObject([
      { operation: 'upsert', payload: { version: 2, ranking: '3.1' } },
    ]);
  });

  it('updates a match, snapshots a newly associated player and rejects foreign-family players', async () => {
    await seedMatch();
    await db.players.put({ ...player('player-2'), first_name: 'Bea', last_name: 'Player', ranking: '2.8', category: 'U18' });
    const changes: MatchChanges = {
      match_date: '2026-02-02', player_id: 'player-2', opponent: 'Cam', opponent_ranking: '2.1',
      opponent_category: 'U14', tournament: 'Cup', tournament_match_number: 8, number_of_sets: 5,
      third_set_type: 'super-tiebreak', super_tiebreak_target: 12, tiebreak_target: 10,
      tiebreak_starts_at_363: false, deuce_single_point: true, first_server: 'opponent',
      status: 'completed', result: '6-2 6-4',
    };
    const saved = await updateMatch('family-1', 'match-1', changes);
    expect(saved).toMatchObject({
      ...changes, version: 2, player_first_name_snapshot: 'Bea', player_last_name_snapshot: 'Player',
      player_ranking_snapshot: '2.8', player_category_snapshot: 'U18',
    });
    expect(saved.updated_at).not.toBe(now);
    const reopenedMatch = await db.matches.get('match-1');
    expect(reopenedMatch).toBeDefined();
    expect(configuredSetNavigation(reopenedMatch!.number_of_sets, [])).toHaveLength(5);
    expect(await operations('match-1')).toMatchObject([
      { operation: 'upsert', payload: { version: 2, player_id: 'player-2' } },
    ]);

    await expect(updateMatch('family-1', 'match-1', { ...changes, player_id: 'other-family' }))
      .rejects.toThrow('Giocatore non trovato nello spazio attivo.');
    expect((await db.matches.get('match-1'))?.player_id).toBe('player-2');
  });

  it('updates set and game numbering while deriving their scores', async () => {
    await seedMatch(true);

    const savedSet = await updateSet('family-1', 'set-1', { set_number: 2 });
    const savedGame = await updateGame('family-1', 'game-1', { game_number: 3 });
    expect(savedSet).toMatchObject({ set_number: 2, player_games: 1, opponent_games: 0, version: 2 });
    expect(savedGame).toMatchObject({ game_number: 3, player_points: 4, opponent_points: 0, version: 2 });
    expect(await operations('set-1')).toMatchObject([{ operation: 'upsert', payload: { version: 2, set_number: 2 } }]);
    expect(await operations('game-1')).toMatchObject([{ operation: 'upsert', payload: { version: 2, game_number: 3 } }]);
  });

  it('updates and soft-deletes games and points in configured sets four and five', async () => {
    await seedMatch();
    await db.matches.put({ ...match(), number_of_sets: 5 });
    await db.sets.bulkAdd([tennisSet('set-4', 4), tennisSet('set-5', 5)]);
    await db.games.bulkAdd([
      tennisGame('game-4', 'set-4'),
      tennisGame('game-5', 'set-5'),
    ]);
    await db.points.bulkAdd([
      { ...point('point-4', 1), game_id: 'game-4' },
      { ...point('point-5', 1), game_id: 'game-5' },
    ]);

    await updateGame('family-1', 'game-4', { game_number: 2 });
    await updateGame('family-1', 'game-5', { game_number: 2 });
    const pointChanges: PointChanges = {
      winner: 'opponent', server: 'player', second_serve: false, double_fault: false, shot_count: 3,
      free_error: false, error_player: undefined, error_category: undefined, attack_error: false,
      pressure_situation: false, pressure_error_player: undefined,
    };
    await updatePoint('family-1', 'point-4', pointChanges);
    await updatePoint('family-1', 'point-5', pointChanges);
    await softDeletePoint('family-1', 'point-4');
    await softDeletePoint('family-1', 'point-5');
    await softDeleteGame('family-1', 'game-4');
    await softDeleteGame('family-1', 'game-5');

    expect(await db.games.get('game-4')).toMatchObject({ game_number: 2, deleted: true });
    expect(await db.games.get('game-5')).toMatchObject({ game_number: 2, deleted: true });
    expect(await db.points.get('point-4')).toMatchObject({ deleted: true });
    expect(await db.points.get('point-5')).toMatchObject({ deleted: true });
    expect((await operations('game-4')).every(operation => operation.operation === 'upsert')).toBe(true);
    expect((await operations('game-5')).every(operation => operation.operation === 'upsert')).toBe(true);
  });

  it('edits point statistics and recalculates game/set scores atomically', async () => {
    await seedMatch(true);
    const changes: PointChanges = {
      winner: 'opponent', server: 'opponent', second_serve: true, double_fault: true,
      shot_count: 5, free_error: true, error_player: 'player', error_category: 'backhand',
      attack_error: true, pressure_situation: true, pressure_error_player: 'player',
    };
    const saved = await updatePoint('family-1', 'point-1', changes);
    expect(saved).toMatchObject({ ...changes, version: 2 });
    expect(await db.games.get('game-1')).toMatchObject({ player_points: 3, opponent_points: 1, version: 2 });
    expect(await db.sets.get('set-1')).toMatchObject({ player_games: 0, opponent_games: 0, version: 2 });
    expect(await operations('point-1')).toMatchObject([{ operation: 'upsert', payload: { version: 2, winner: 'opponent' } }]);
    expect(await operations('game-1')).toMatchObject([{ operation: 'upsert', payload: { player_points: 3 } }]);
    expect(await operations('set-1')).toMatchObject([{ operation: 'upsert', payload: { player_games: 0 } }]);
  });

  it('soft-deletes a player without deleting its match', async () => {
    await seedMatch();
    await softDeletePlayer('family-1', 'player-1');
    expect(await db.players.get('player-1')).toMatchObject({ deleted: true, version: 2 });
    expect(await db.matches.get('match-1')).toMatchObject({ deleted: false, player_id: 'player-1', player_first_name_snapshot: 'Ada' });
    expect(await operations('player-1')).toMatchObject([{ operation: 'upsert', payload: { deleted: true, version: 2 } }]);
  });

  it('soft-deletes a match and all live descendants with queued tombstones', async () => {
    await seedMatch(true);
    await softDeleteMatch('family-1', 'match-1');

    expect(await db.matches.get('match-1')).toMatchObject({ deleted: true, version: 2 });
    expect(await db.sets.get('set-1')).toMatchObject({ deleted: true, version: 2 });
    expect(await db.games.get('game-1')).toMatchObject({ deleted: true, version: 2 });
    expect((await db.points.toArray()).every(record => record.deleted && record.version === 2)).toBe(true);
    expect((await db.syncQueue.toArray()).every(operation => operation.operation === 'upsert')).toBe(true);
    expect(await db.syncQueue.count()).toBe(7);
  });

  it('soft-deletes a set and its games and points', async () => {
    await seedMatch(true);
    await softDeleteSet('family-1', 'set-1');
    expect(await db.sets.get('set-1')).toMatchObject({ deleted: true, version: 2 });
    expect(await db.games.get('game-1')).toMatchObject({ deleted: true, version: 2 });
    expect((await db.points.toArray()).every(record => record.deleted)).toBe(true);
    expect(await db.syncQueue.count()).toBe(6);
  });

  it('soft-deletes a game and its points and recalculates its set', async () => {
    await seedMatch(true);
    await softDeleteGame('family-1', 'game-1');
    expect(await db.games.get('game-1')).toMatchObject({ deleted: true, version: 2 });
    expect((await db.points.toArray()).every(record => record.deleted)).toBe(true);
    expect(await db.sets.get('set-1')).toMatchObject({ player_games: 0, opponent_games: 0, version: 2 });
    expect(await db.syncQueue.count()).toBe(6);
  });

  it('soft-deletes only one point and excludes it from scores and KPIs', async () => {
    await seedMatch(true);
    await softDeletePoint('family-1', 'point-4');
    const scored = await getMatchPoints('family-1', 'match-1');

    expect(await db.points.get('point-4')).toMatchObject({ deleted: true, version: 2 });
    expect(scored).toHaveLength(3);
    expect(serveKpi(scored, 'player').pointsWon).toBe(3);
    expect(await db.games.get('game-1')).toMatchObject({ player_points: 3, opponent_points: 0, version: 2 });
    expect(await db.sets.get('set-1')).toMatchObject({ player_games: 0, version: 2 });
    expect((await operations('point-4'))[0]).toMatchObject({ operation: 'upsert', payload: { deleted: true } });
  });

  it('rejects duplicate set numbers and rolls back both the record and sync queue', async () => {
    await seedMatch();
    await db.sets.add(tennisSet('set-2', 2));
    const queueBefore = await db.syncQueue.count();

    await expect(updateSet('family-1', 'set-2', { set_number: 1 })).rejects.toMatchObject({ name: 'ConstraintError' });
    expect(await db.sets.get('set-2')).toMatchObject({ set_number: 2, version: 1, updated_at: now });
    expect(await db.syncQueue.count()).toBe(queueBefore);
  });

  it('rejects duplicate game numbers and rolls back the game update', async () => {
    await seedMatch();
    await db.games.add(tennisGame('game-2', 'set-1', 2));
    await expect(updateGame('family-1', 'game-2', { game_number: 1 }))
      .rejects.toMatchObject({ name: 'ConstraintError' });
    expect(await db.games.get('game-2')).toMatchObject({ game_number: 2, version: 1, updated_at: now });
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('rolls back a record update when writing its sync operation fails', async () => {
    await seedMatch();
    const queueWrite = vi.spyOn(db.syncQueue, 'put').mockImplementation(() =>
      new Dexie.Promise<string>((_resolve, reject) => reject(new Error('simulated queue failure'))));
    try {
      await expect(updatePlayer('family-1', 'player-1', {
        first_name: 'Changed', last_name: 'Name', birth_date: null, category: 'U18', ranking: '2.0',
      })).rejects.toThrow('simulated queue failure');
    } finally {
      queueWrite.mockRestore();
    }

    expect(await db.players.get('player-1')).toMatchObject({ first_name: 'Ada', version: 1, updated_at: now });
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('rejects cross-family mutation without changing the foreign record', async () => {
    await seedMatch();
    await expect(updatePlayer('family-2', 'player-1', {
      first_name: 'Changed', last_name: 'Name', birth_date: null, category: 'U18', ranking: '2.0',
    })).rejects.toThrow('Giocatore non trovato nello spazio attivo.');
    expect((await db.players.get('player-1'))?.first_name).toBe('Ada');
    expect(await db.syncQueue.count()).toBe(0);
  });
});

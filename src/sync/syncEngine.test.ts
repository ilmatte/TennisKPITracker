import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import type {
  FamilyMember,
  Game,
  Match,
  Player,
  Point,
  SyncEntityType,
  SyncMapping,
  SyncOperation,
  TennisSet,
} from '../types';
import type { ApplyRecordResult, RemoteChange, RemoteFamily, SyncRepository } from './contracts';
import { markSyncFailure, recordQueueFailure, runSync } from './syncEngine';
import { readRecordBaseline, saveSyncMapping } from './syncState';

const localFamilyId = 'local-family';
const remoteFamilyId = 'remote-family';
const now = '2026-03-01T10:00:00.000Z';

class FakeSyncRepository implements SyncRepository {
  records = new Map<SyncEntityType, Map<string, Record<string, unknown>>>();
  changes: RemoteChange[] = [];
  calls: SyncEntityType[] = [];
  revision = 0;
  failOnListCall: number | null = null;
  listCalls = 0;
  failAfterCommit = false;
  afterCommit: (() => Promise<void>) | null = null;
  createdIds: string[] = [];
  committedOperations = new Map<string, ApplyRecordResult>();
  memberships: FamilyMember[] = [];

  constructor() {
    for (const type of ['players', 'matches', 'sets', 'games', 'points'] as const) {
      this.records.set(type, new Map());
    }
  }

  seed<T extends { id: string }>(type: SyncEntityType, record: T) {
    const remoteRecord: Record<string, unknown> = Object.assign({}, record, { family_id: remoteFamilyId });
    this.records.get(type)!.set(record.id, remoteRecord);
  }

  async getAuthenticatedUserId() {
    return 'owner-id';
  }

  async getMemberships() {
    return this.memberships;
  }

  async getFamily(): Promise<RemoteFamily> {
    return {
      id: remoteFamilyId,
      name: 'Remote',
      created_by: 'owner-id',
      created_at: now,
      updated_at: now,
      sync_revision: this.revision,
    };
  }

  async createFamily(id: string) {
    this.createdIds.push(id);
    return id;
  }

  snapshotRecords: Map<SyncEntityType, Map<string, Record<string, unknown>>> | null = null;
  snapshotRevision = 0;

  async beginInitialSnapshot(familyId: string) {
    if (familyId !== remoteFamilyId) throw new Error('wrong remote family');
    this.snapshotRevision = this.revision;
    this.snapshotRecords = new Map<SyncEntityType, Map<string, Record<string, unknown>>>();
    for (const [type, records] of this.records) {
      this.snapshotRecords.set(type, new Map(records));
    }
    return this.snapshotRevision;
  }

  async listSnapshot(type: SyncEntityType, familyId: string, revision: number, afterId: string, limit: number) {
    if (familyId !== remoteFamilyId) throw new Error('wrong remote family');
    this.listCalls++;
    if (this.failOnListCall === this.listCalls) throw new TypeError('network interrupted');
    if (revision !== this.snapshotRevision || !this.snapshotRecords) throw new Error('snapshot revision mismatch');
    return [...this.snapshotRecords.get(type)!.values()]
      .filter(record => String(record.id) > afterId)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .slice(0, limit);
  }

  async applyRecord(input: {
    familyId: string;
    operationId: string;
    entityType: SyncEntityType;
    entityId: string;
    baseVersion: number;
    payload: Record<string, unknown>;
  }): Promise<ApplyRecordResult> {
    if (input.familyId !== remoteFamilyId) throw new Error('wrong remote family');
    this.calls.push(input.entityType);
    const prior = this.committedOperations.get(input.operationId);
    if (prior) return prior;
    const table = this.records.get(input.entityType)!;
    const current = table.get(input.entityId);
    if ((current?.version ?? 0) !== input.baseVersion) {
      return {
        status: 'conflict',
        remote_version: Number(current?.version ?? 0),
        record: current ?? null,
      };
    }
    const record = {
      ...input.payload,
      family_id: remoteFamilyId,
      version: Number(current?.version ?? 0) + 1,
      updated_at: now,
    };
    table.set(input.entityId, record);
    this.revision++;
    this.changes.push({
      revision: this.revision,
      entity_type: input.entityType,
      entity_id: input.entityId,
      payload: record,
    });
    if (this.failAfterCommit) {
      this.failAfterCommit = false;
      await this.afterCommit?.();
      throw new TypeError('response lost after server commit');
    }
    const applied: ApplyRecordResult = {
      status: 'applied',
      remote_version: Number(record.version),
      revision: this.revision,
      record,
    };
    this.committedOperations.set(input.operationId, applied);
    return applied;
  }

  async pullChanges(_familyId: string, afterRevision: number, limit: number) {
    const changes = this.changes.filter(change => change.revision > afterRevision).slice(0, limit);
    return {
      changes,
      nextRevision: changes.length ? changes[changes.length - 1].revision : afterRevision,
    };
  }
}

function mapping(overrides: Partial<SyncMapping> = {}): SyncMapping {
  return {
    kind: 'mapping',
    local_family_id: localFamilyId,
    remote_family_id: remoteFamilyId,
    user_id: 'owner-id',
    role: 'owner',
    enabled: true,
    status: 'syncing',
    initial_download_started: false,
    initial_download_complete: false,
    initial_download_revision: null,
    initial_download_cursors: {},
    download_revision: 0,
    last_download_completed_at: null,
    last_upload_completed_at: null,
    retry_count: 0,
    next_retry_at: null,
    last_error: null,
    updated_at: now,
    ...overrides,
  };
}

function localPlayer(id = 'player-id', version = 1): Player {
  return {
    id, family_id: localFamilyId, first_name: 'Ada', last_name: 'Lovelace', birth_date: null,
    category: 'U16', ranking: '4.1', created_at: now, updated_at: now, version, deleted: false,
  };
}

function queue(type: SyncEntityType, record: { id: string; version: number; family_id: string; updated_at: string }): SyncOperation {
  return {
    id: `queue-${type}-${record.id}-${record.version}`,
    family_id: localFamilyId,
    entity_type: type,
    entity_id: record.id,
    operation: 'upsert',
    payload: record,
    created_at: record.updated_at,
    attempts: 0,
  };
}

beforeEach(async () => {
  await db.transaction('rw', [
    db.families, db.family_members, db.family_invitations, db.players, db.matches,
    db.sets, db.games, db.points, db.syncQueue, db.syncMetadata, db.syncConflicts,
  ], async () => {
    await Promise.all([
      db.families.clear(), db.family_members.clear(), db.family_invitations.clear(),
      db.players.clear(), db.matches.clear(), db.sets.clear(), db.games.clear(),
      db.points.clear(), db.syncQueue.clear(), db.syncMetadata.clear(), db.syncConflicts.clear(),
    ]);
  });
});

describe('sync engine', () => {
  it('downloads all entities in dependency order and preserves sport IDs while mapping family IDs', async () => {
    const remote = new FakeSyncRepository();
    remote.seed('players', { ...localPlayer(), family_id: remoteFamilyId, version: 3 });
    const match: Match = {
      id: 'match-id', family_id: remoteFamilyId, match_date: '2026-03-01', player_id: 'player-id',
      player_first_name_snapshot: 'Ada', player_last_name_snapshot: 'Lovelace',
      player_ranking_snapshot: '4.1', player_category_snapshot: 'U16', opponent: 'Bea',
      number_of_sets: 3, third_set_type: 'normal', super_tiebreak_target: 10, tiebreak_target: 7,
      tiebreak_starts_at_363: true, deuce_single_point: true, first_server: 'player',
      status: 'in-progress', created_at: now, updated_at: now, version: 2, deleted: false,
    };
    const tennisSet: TennisSet = {
      id: 'set-id', family_id: remoteFamilyId, match_id: match.id, set_number: 1,
      player_games: 1, opponent_games: 0, created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const game: Game = {
      id: 'game-id', family_id: remoteFamilyId, set_id: tennisSet.id, game_number: 1,
      player_points: 1, opponent_points: 0, created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const point: Point = {
      id: 'point-id', family_id: remoteFamilyId, game_id: game.id, point_number: 1,
      winner: 'player', server: 'player', second_serve: false, double_fault: false, shot_count: 3,
      free_error: false, attack_error: false, pressure_situation: false,
      created_at: now, updated_at: now, version: 1, deleted: true,
    };
    remote.seed('matches', match);
    remote.seed('sets', tennisSet);
    remote.seed('games', game);
    remote.seed('points', point);
    const state = mapping();
    await saveSyncMapping(state);

    const result = await runSync(remote, state, remote.revision);

    expect(result.status).toBe('synced');
    expect(await db.players.get('player-id')).toMatchObject({ id: 'player-id', family_id: localFamilyId, version: 3 });
    expect(await db.matches.get('match-id')).toMatchObject({ player_id: 'player-id', family_id: localFamilyId });
    expect(await db.sets.get('set-id')).toMatchObject({ match_id: 'match-id', family_id: localFamilyId });
    expect(await db.games.get('game-id')).toMatchObject({ set_id: 'set-id', family_id: localFamilyId });
    expect(await db.points.get('point-id')).toMatchObject({ game_id: 'game-id', deleted: true, family_id: localFamilyId });
    expect(await readRecordBaseline('points', 'point-id')).toMatchObject({ remote_version: 1 });
    expect(state.initial_download_complete).toBe(true);
  });

  it('uploads the latest queued records parent-first and transmits tombstones as upserts', async () => {
    const remote = new FakeSyncRepository();
    const player = { ...localPlayer('player-id', 2), deleted: true };
    const match: Match = {
      id: 'match-id', family_id: localFamilyId, match_date: '2026-03-01', player_id: player.id,
      player_first_name_snapshot: 'Ada', player_last_name_snapshot: 'Lovelace',
      player_ranking_snapshot: '4.1', player_category_snapshot: 'U16', opponent: 'Bea',
      number_of_sets: 3, third_set_type: 'normal', super_tiebreak_target: 10, tiebreak_target: 7,
      tiebreak_starts_at_363: true, deuce_single_point: true, first_server: 'player',
      status: 'in-progress', created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const tennisSet: TennisSet = {
      id: 'set-id', family_id: localFamilyId, match_id: match.id, set_number: 1,
      player_games: 0, opponent_games: 0, created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const game: Game = {
      id: 'game-id', family_id: localFamilyId, set_id: tennisSet.id, game_number: 1,
      player_points: 0, opponent_points: 0, created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const point: Point = {
      id: 'point-id', family_id: localFamilyId, game_id: game.id, point_number: 1,
      winner: 'player', server: 'player', second_serve: false, double_fault: false, shot_count: 1,
      free_error: false, attack_error: false, pressure_situation: false,
      created_at: now, updated_at: now, version: 1, deleted: true,
    };
    await db.players.add(player);
    await db.matches.add(match);
    await db.sets.add(tennisSet);
    await db.games.add(game);
    await db.points.add(point);
    await db.syncQueue.bulkAdd([
      queue('players', player), queue('matches', match), queue('sets', tennisSet),
      queue('games', game), queue('points', point),
      queue('players', { ...player, version: 1 }),
    ]);
    const state = mapping({ initial_download_complete: true });
    await saveSyncMapping(state);

    const result = await runSync(remote, state, 0);

    expect(remote.calls).toEqual(['players', 'matches', 'sets', 'games', 'points']);
    expect(remote.records.get('players')!.get(player.id)).toMatchObject({
      id: player.id, family_id: remoteFamilyId, deleted: true, version: 1,
    });
    expect(remote.records.get('points')!.get(point.id)).toMatchObject({ deleted: true, family_id: remoteFamilyId });
    expect(await db.syncQueue.count()).toBe(0);
    expect(result.uploaded).toBe(5);
  });

  it('records a version conflict without overwriting local data or dropping the queue entry', async () => {
    const remote = new FakeSyncRepository();
    const local = localPlayer();
    remote.seed('players', { ...localPlayer(), family_id: remoteFamilyId, first_name: 'Remote', version: 2 });
    await db.players.add(local);
    await db.syncQueue.add(queue('players', local));
    const state = mapping({ initial_download_complete: true });
    await saveSyncMapping(state);

    const result = await runSync(remote, state, 0);

    expect(await db.players.get(local.id)).toMatchObject({ first_name: 'Ada', version: 1 });
    expect(await db.syncQueue.where('entity_id').equals(local.id).count()).toBe(1);
    expect(await db.syncConflicts.toArray()).toMatchObject([
      { entity_type: 'players', entity_id: local.id, base_version: 0, remote_version: 2, status: 'unresolved' },
    ]);
    expect(result.status).toBe('needs-attention');
  });

  it('persists downloaded conflicts while continuing to upload unrelated records', async () => {
    const remote = new FakeSyncRepository();
    const local = localPlayer();
    const independent = localPlayer('independent-player');
    remote.seed('players', { ...local, family_id: remoteFamilyId, first_name: 'Remote', version: 2 });
    remote.revision = 1;
    remote.changes.push({
      revision: 1,
      entity_type: 'players',
      entity_id: local.id,
      payload: { ...local, family_id: remoteFamilyId, first_name: 'Remote', version: 2 },
    });
    await db.players.bulkAdd([local, independent]);
    await db.syncQueue.bulkAdd([queue('players', local), queue('players', independent)]);
    const state = mapping({ initial_download_complete: true });
    await saveSyncMapping(state);

    const result = await runSync(remote, state, remote.revision);

    expect(await db.players.get(local.id)).toMatchObject({ first_name: 'Ada' });
    expect(await db.players.get(independent.id)).toMatchObject({ first_name: 'Ada' });
    expect(await db.syncQueue.where('entity_id').equals(local.id).count()).toBe(1);
    expect(await db.syncQueue.where('entity_id').equals(independent.id).count()).toBe(0);
    expect(remote.records.get('players')!.get(independent.id)).toMatchObject({ family_id: remoteFamilyId });
    expect(result.status).toBe('needs-attention');
    expect(result.uploaded).toBe(1);
    expect(result.conflicts).toHaveLength(1);
  });

  it('recovers after a response is lost after the server committed the upload', async () => {
    const remote = new FakeSyncRepository();
    const player = localPlayer();
    await db.players.add(player);
    await db.syncQueue.add(queue('players', player));
    const state = mapping({ initial_download_complete: true });
    await saveSyncMapping(state);
    remote.failAfterCommit = true;
    remote.afterCommit = async () => {
      const changed = { ...player, first_name: 'Grace', version: 2, updated_at: '2026-03-01T10:01:00.000Z' };
      await db.players.put(changed);
      await db.syncQueue.add(queue('players', changed));
    };

    await expect(runSync(remote, state, 0)).rejects.toThrow('response lost after server commit');
    expect(await db.syncQueue.count()).toBe(2);
    const resumed = await runSync(remote, state, remote.revision);

    expect(resumed.status).toBe('synced');
    expect(await db.syncQueue.count()).toBe(0);
    expect(remote.records.get('players')!.size).toBe(1);
    expect(remote.records.get('players')!.get(player.id)).toMatchObject({ first_name: 'Grace', version: 2 });
    expect(await db.players.get(player.id)).toMatchObject({ first_name: 'Grace', version: 2 });
    expect(await readRecordBaseline('players', player.id)).toMatchObject({ remote_version: 2 });
  });

  it('checkpoints each initial download page so interrupted downloads resume without skipping records', async () => {
    const remote = new FakeSyncRepository();
    for (let index = 1; index <= 201; index++) {
      const id = `player-${String(index).padStart(3, '0')}`;
      remote.seed('players', { ...localPlayer(id), family_id: remoteFamilyId });
    }
    remote.failOnListCall = 2;
    const state = mapping();
    await saveSyncMapping(state);

    await expect(runSync(remote, state, 0)).rejects.toThrow('network interrupted');
    expect(await db.players.count()).toBe(200);
    expect(state.initial_download_cursors.players).toBe('player-200');

    remote.failOnListCall = null;
    const resumed = await runSync(remote, state, 0);

    expect(resumed.status).toBe('synced');
    expect(await db.players.count()).toBe(201);
    expect(state.initial_download_complete).toBe(true);
  });

  it('simulates snapshot consistency and subsequent changes across two devices', async () => {
    const remote = new FakeSyncRepository();
    const original = localPlayer();
    remote.seed('players', { ...original, family_id: remoteFamilyId, first_name: 'Ada' });

    const state = mapping();
    await saveSyncMapping(state);
    const snapshotRevision = await remote.beginInitialSnapshot(remoteFamilyId);
    state.initial_download_started = true;
    state.initial_download_revision = snapshotRevision;
    state.initial_download_cursors = {};
    await saveSyncMapping(state);

    const changedByB = {
      ...original,
      family_id: remoteFamilyId,
      first_name: 'Grace',
      version: 2,
      updated_at: '2026-03-01T10:01:00.000Z',
    };
    remote.records.get('players')!.set(original.id, changedByB);
    remote.revision = snapshotRevision + 1;
    remote.changes.push({
      revision: remote.revision,
      entity_type: 'players',
      entity_id: original.id,
      payload: changedByB,
    });

    const result = await runSync(remote, state, remote.revision);

    expect(result.status).toBe('synced');
    expect(await db.players.get(original.id)).toMatchObject({ first_name: 'Grace', version: 2 });
    expect(state.initial_download_revision).toBe(snapshotRevision);
    expect(state.download_revision).toBe(snapshotRevision + 1);
  });

  it('does not increment the server revision when retrying the same operation after a lost response', async () => {
    const remote = new FakeSyncRepository();
    const player = localPlayer();
    await db.players.add(player);
    await db.syncQueue.add({ ...queue('players', player), operation_id: 'operation-player-1' });
    const state = mapping({ initial_download_complete: true });
    await saveSyncMapping(state);
    remote.failAfterCommit = true;

    await expect(runSync(remote, state, 0)).rejects.toThrow('response lost after server commit');
    const revisionAfterCommit = remote.revision;
    const callsAfterCommit = remote.calls.length;

    const resumed = await runSync(remote, state, remote.revision);

    expect(resumed.status).toBe('synced');
    expect(remote.revision).toBe(revisionAfterCommit);
    expect(remote.calls.length).toBe(callsAfterCommit);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('keeps a local pending modification when a remote tombstone is downloaded', async () => {
    const remote = new FakeSyncRepository();
    const local = localPlayer();
    await db.players.add(local);
    await db.syncQueue.add(queue('players', local));
    remote.seed('players', { ...local, family_id: remoteFamilyId, deleted: true, version: 2 });
    remote.revision = 1;
    remote.changes.push({
      revision: 1,
      entity_type: 'players',
      entity_id: local.id,
      payload: { ...local, family_id: remoteFamilyId, deleted: true, version: 2 },
    });
    const state = mapping({ initial_download_complete: true });
    await saveSyncMapping(state);

    const result = await runSync(remote, state, remote.revision);

    expect(await db.players.get(local.id)).toMatchObject({ deleted: false, version: 1 });
    expect(await db.syncQueue.where('entity_id').equals(local.id).count()).toBe(1);
    expect(await db.syncConflicts.where('entity_id').equals(local.id).toArray()).toMatchObject([
      { reason: 'version', status: 'unresolved' },
    ]);
    expect(result.status).toBe('needs-attention');
  });

  it('persists progressive retry state and queue attempt details for recoverable failures', async () => {
    const state = mapping({ retry_count: 2 });
    const player = localPlayer();
    await db.syncQueue.add(queue('players', player));

    await recordQueueFailure(localFamilyId, new TypeError('network unavailable'));
    await markSyncFailure(state, new TypeError('network unavailable'));

    expect(await db.syncQueue.get(`queue-players-${player.id}-1`))
      .toMatchObject({ attempts: 1, last_error: 'Tennis Tracker Cloud non è momentaneamente raggiungibile.' });
    expect(state).toMatchObject({
      retry_count: 3,
      status: 'retryable-error',
      last_error: 'Tennis Tracker Cloud non è momentaneamente raggiungibile.',
    });
    expect(Date.parse(state.next_retry_at!)).toBeGreaterThan(Date.now());
  });
});

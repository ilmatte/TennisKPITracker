import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import type { Family, FamilyMember } from '../types';
import type { ApplyRecordResult, RemoteChange, RemoteFamily, SyncRepository } from './contracts';
import { countLocalSportsRecords, provisionSync } from './provisioning';
import { readSyncMapping } from './syncState';

const now = '2026-03-01T10:00:00.000Z';

class ProvisionRepository implements SyncRepository {
  authenticatedUserId = 'owner-id';
  memberships: FamilyMember[] = [];
  family: RemoteFamily = {
    id: 'remote-existing',
    name: 'Remote family',
    created_by: 'owner-id',
    created_at: now,
    updated_at: now,
    sync_revision: 0,
  };
  created: Array<{ id: string; name: string }> = [];

  async getAuthenticatedUserId() {
    return this.authenticatedUserId;
  }
  async getMemberships() {
    return this.memberships;
  }
  async getFamily() {
    return this.family;
  }
  async createFamily(id: string, name: string) {
    this.created.push({ id, name });
    this.family = { ...this.family, id, name, created_by: 'owner-id' };
    return id;
  }
  async beginInitialSnapshot() {
    return 0;
  }
  async listSnapshot() {
    return [];
  }
  async applyRecord(): Promise<ApplyRecordResult> {
    throw new Error('not used');
  }
  async pullChanges(): Promise<{ changes: RemoteChange[]; nextRevision: number }> {
    return { changes: [], nextRevision: 0 };
  }
}

function workspace(id = 'local-workspace'): Family {
  return {
    id,
    name: 'Tennis KPI Tracker',
    created_at: now,
    updated_at: now,
    created_by: null,
    local_only: true,
  };
}

function membership(familyId: string, role: FamilyMember['role']): FamilyMember {
  return {
    family_id: familyId,
    user_id: 'owner-id',
    member_email: 'owner@example.test',
    role,
    created_at: now,
  };
}

beforeEach(async () => {
  await db.transaction('rw', [
    db.families, db.family_members, db.players, db.matches, db.sets, db.games,
    db.points, db.syncQueue, db.syncMetadata, db.syncConflicts,
  ], async () => {
    await Promise.all([
      db.families.clear(), db.family_members.clear(), db.players.clear(), db.matches.clear(),
      db.sets.clear(), db.games.clear(), db.points.clear(), db.syncQueue.clear(),
      db.syncMetadata.clear(), db.syncConflicts.clear(),
    ]);
  });
});

describe('sync provisioning', () => {
  it('creates a remote owner family only when explicitly provisioned and prefers the local UUID', async () => {
    const repository = new ProvisionRepository();
    const result = await provisionSync(repository, workspace(), 'owner-id');

    expect(repository.created).toEqual([{ id: 'local-workspace', name: 'Tennis KPI Tracker' }]);
    expect(result).toMatchObject({
      mapping: {
        local_family_id: 'local-workspace',
        remote_family_id: 'local-workspace',
        role: 'owner',
        enabled: true,
      },
      family: { id: 'local-workspace', created_by: 'owner-id' },
    });
    expect(await readSyncMapping()).toMatchObject({ remote_family_id: 'local-workspace', role: 'owner' });
  });

  it('reuses an existing owner family with a different UUID without changing local IDs', async () => {
    const repository = new ProvisionRepository();
    repository.memberships = [membership('remote-existing', 'owner')];
    const result = await provisionSync(repository, workspace(), 'owner-id');

    expect(repository.created).toHaveLength(0);
    expect(result).toMatchObject({
      mapping: { local_family_id: 'local-workspace', remote_family_id: 'remote-existing', role: 'owner' },
      family: { id: 'remote-existing' },
    });
    expect(await db.families.get('local-workspace')).toBeUndefined();
  });

  it('never provisions a new owner family for an invited member on an empty device', async () => {
    const repository = new ProvisionRepository();
    repository.family = { ...repository.family, created_by: 'another-owner' };
    repository.memberships = [membership('remote-existing', 'member')];

    const result = await provisionSync(repository, workspace(), 'owner-id');

    expect(repository.created).toHaveLength(0);
    expect(result).toMatchObject({
      mapping: { remote_family_id: 'remote-existing', role: 'member', enabled: true },
    });
  });

  it('pauses member association when independent local sports data already exists', async () => {
    const repository = new ProvisionRepository();
    repository.family = { ...repository.family, created_by: 'another-owner' };
    repository.memberships = [membership('remote-existing', 'member')];
    await db.players.add({
      id: 'local-player',
      family_id: 'local-workspace',
      first_name: 'Local',
      last_name: 'Player',
      category: '',
      ranking: '',
      created_at: now,
      updated_at: now,
      version: 1,
      deleted: false,
    });

    const result = await provisionSync(repository, workspace(), 'owner-id');

    expect(await countLocalSportsRecords('local-workspace')).toBe(1);
    expect(result).toMatchObject({
      needsAttention: true,
      mapping: {
        remote_family_id: 'remote-existing',
        role: 'member',
        enabled: false,
        status: 'needs-attention',
      },
    });
    expect(await db.players.get('local-player')).toMatchObject({ family_id: 'local-workspace' });
  });

  it('does not choose arbitrarily when the account belongs to multiple families', async () => {
    const repository = new ProvisionRepository();
    repository.memberships = [
      membership('remote-one', 'member'),
      { ...membership('remote-two', 'member'), family_id: 'remote-two' },
    ];

    const result = await provisionSync(repository, workspace(), 'owner-id');

    expect(result).toMatchObject({
      needsAttention: true,
      mapping: { remote_family_id: null, enabled: false, status: 'needs-attention' },
    });
    expect(repository.created).toHaveLength(0);
  });

  it('does not create a family when the authenticated Supabase identity does not match the app account', async () => {
    const repository = new ProvisionRepository();
    repository.authenticatedUserId = 'different-user';

    await expect(provisionSync(repository, workspace(), 'owner-id'))
      .rejects.toThrow('La session Supabase non corrisponde all’account autenticato nell’app.');
    expect(repository.created).toHaveLength(0);
  });
});

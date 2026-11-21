import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { db } from '../db/database';
import { AuthContext } from '../features/auth/AuthContext';
import { FamilyProvider } from '../features/families/FamilyContext';
import { SyncProvider } from './SyncContext';
import { useSync } from './SyncContextDefinition';
import { readSyncMapping } from './syncState';

const now = '2026-03-01T10:00:00.000Z';

function SyncProbe() {
  const { status, mapping } = useSync();
  return <output data-testid="sync-status">{`${status}:${mapping?.enabled ?? false}`}</output>;
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
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => cleanup());

describe('sync activation boundary', () => {
  it('keeps Google login separate from provisioning and sync activation', async () => {
    const user = {
      id: 'authenticated-user',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: now,
    } as User;

    render(
      <AuthContext.Provider value={{ user, loading: false }}>
        <FamilyProvider>
          <SyncProvider><SyncProbe /></SyncProvider>
        </FamilyProvider>
      </AuthContext.Provider>,
    );

    await waitFor(async () => {
      expect(await readSyncMapping()).toMatchObject({
        user_id: user.id,
        remote_family_id: null,
        enabled: false,
        status: 'signed-in-disabled',
      });
    });
    expect(await screen.findByTestId('sync-status')).toHaveTextContent('signed-in-disabled:false');
    expect(await db.families.count()).toBe(1);
    expect(await db.family_members.count()).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });
});

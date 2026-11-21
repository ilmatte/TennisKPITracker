import { db } from '../db/database';
import type { Family, SyncMapping } from '../types';
import type { ProvisionedSync, SyncRepository } from './contracts';
import { saveSyncMapping } from './syncState';

const now = () => new Date().toISOString();

export async function countLocalSportsRecords(localFamilyId: string): Promise<number> {
  const [players, matches, sets, games, points] = await Promise.all([
    db.players.where('family_id').equals(localFamilyId).count(),
    db.matches.where('family_id').equals(localFamilyId).count(),
    db.sets.where('family_id').equals(localFamilyId).count(),
    db.games.where('family_id').equals(localFamilyId).count(),
    db.points.where('family_id').equals(localFamilyId).count(),
  ]);
  return players + matches + sets + games + points;
}

function mapping(
  localFamilyId: string,
  userId: string,
  remoteFamilyId: string | null,
  role: SyncMapping['role'],
  status: SyncMapping['status'],
  enabled: boolean,
): SyncMapping {
  return {
    kind: 'mapping',
    local_family_id: localFamilyId,
    remote_family_id: remoteFamilyId,
    user_id: userId,
    role,
    enabled,
    status,
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
    updated_at: now(),
  };
}

export async function provisionSync(
  repository: SyncRepository,
  localWorkspace: Family,
  userId: string,
): Promise<ProvisionedSync | { mapping: SyncMapping; needsAttention: true }> {
  const authenticatedUserId = await repository.getAuthenticatedUserId();
  if (!authenticatedUserId || authenticatedUserId !== userId) {
    throw new Error('La session Supabase non corrisponde all’account autenticato nell’app.');
  }
  const memberships = await repository.getMemberships(userId);
  if (memberships.length > 1) {
    const needsAttention = mapping(localWorkspace.id, userId, null, null, 'needs-attention', false);
    needsAttention.last_error = 'L’account appartiene a più famiglie remote; è necessario sceglierne una prima della sincronizzazione.';
    needsAttention.updated_at = now();
    await saveSyncMapping(needsAttention);
    return { mapping: needsAttention, needsAttention: true };
  }

  if (memberships.length === 1) {
    const membership = memberships[0];
    const family = await repository.getFamily(membership.family_id);
    if (membership.role === 'owner') {
      if (family.created_by !== userId) {
        throw new Error('Membership owner incoerente con il proprietario della famiglia remota.');
      }
    } else if (family.created_by === userId) {
      throw new Error('Il ruolo member non può essere trattato come proprietario della famiglia.');
    }

    if (membership.role === 'member' && await countLocalSportsRecords(localWorkspace.id) > 0) {
      const needsAttention = mapping(
        localWorkspace.id, userId, family.id, 'member', 'needs-attention', false,
      );
      needsAttention.last_error = 'Sono presenti dati locali indipendenti. La famiglia è stata associata in sola attesa: scegli esplicitamente come procedere prima di importare o unire i dati.';
      needsAttention.updated_at = now();
      await saveSyncMapping(needsAttention);
      return { mapping: needsAttention, needsAttention: true };
    }

    const result = mapping(localWorkspace.id, userId, family.id, membership.role, 'syncing', true);
    await saveSyncMapping(result);
    return { mapping: result, family };
  }

  const familyId = await repository.createFamily(localWorkspace.id, localWorkspace.name);
  const family = await repository.getFamily(familyId);
  if (family.created_by !== userId) {
    throw new Error('La famiglia restituita dal provisioning non appartiene all’account autenticato.');
  }
  const result = mapping(localWorkspace.id, userId, family.id, 'owner', 'syncing', true);
  await saveSyncMapping(result);
  return { mapping: result, family };
}

export async function recordOfflineActivation(localWorkspace: Family, userId: string): Promise<SyncMapping> {
  const result = mapping(localWorkspace.id, userId, null, null, 'offline-pending', true);
  result.last_error = 'Attivazione in attesa di una connessione Internet.';
  await saveSyncMapping(result);
  return result;
}

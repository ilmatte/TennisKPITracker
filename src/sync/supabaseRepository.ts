import type { SupabaseClient } from '@supabase/supabase-js';
import type { FamilyMember, SyncEntityType } from '../types';
import { supabase } from '../services/supabase/client';
import { logTechnicalDiagnostic, normalizeUiError } from '../services/uiMessages';
import type {
  ApplyRecordResult,
  RemoteChange,
  RemoteFamily,
  SyncRepository,
} from './contracts';

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) {
    logTechnicalDiagnostic('cloud-configuration', 'supabase-client-not-configured');
    throw new Error(normalizeUiError('cloud-config'));
  }
  return client;
}

function validateApplyResult(value: unknown): ApplyRecordResult {
  if (!value || typeof value !== 'object') {
    logTechnicalDiagnostic('sync-response-validation', value);
    throw new Error(normalizeUiError('sync'));
  }
  const result = value as Record<string, unknown>;
  if (result.status === 'applied' && typeof result.remote_version === 'number' &&
    typeof result.revision === 'number' && result.record && typeof result.record === 'object') {
    return result as ApplyRecordResult;
  }
  if (result.status === 'conflict' && typeof result.remote_version === 'number' &&
    (result.record === null || (result.record !== undefined && typeof result.record === 'object')) &&
    (result.reason === undefined || result.reason === 'version' || result.reason === 'constraint')) {
    return result as ApplyRecordResult;
  }
  logTechnicalDiagnostic('sync-response-validation', result);
  throw new Error(normalizeUiError('sync'));
}

function validateChanges(value: unknown): { changes: RemoteChange[]; nextRevision: number } {
  if (!value || typeof value !== 'object') {
    logTechnicalDiagnostic('sync-change-validation', value);
    throw new Error(normalizeUiError('sync'));
  }
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.changes) || typeof result.next_revision !== 'number') {
    logTechnicalDiagnostic('sync-change-validation', result);
    throw new Error(normalizeUiError('sync'));
  }
  const changes = result.changes.map((item): RemoteChange => {
    if (!item || typeof item !== 'object') throw new Error('Elemento non valido nel log di sincronizzazione.');
    const change = item as Record<string, unknown>;
    if (typeof change.revision !== 'number' ||
      !['players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'].includes(String(change.entity_type)) ||
      typeof change.entity_id !== 'string' || !change.payload || typeof change.payload !== 'object') {
      throw new Error('Elemento incompleto nel log di sincronizzazione.');
    }
    return change as unknown as RemoteChange;
  });
  return { changes, nextRevision: result.next_revision };
}

export function createSupabaseSyncRepository(client: SupabaseClient | null = supabase): SyncRepository {
  const remote = requireSupabase(client);
  return {
    async getAuthenticatedUserId() {
      const { data, error } = await remote.auth.getUser();
      if (error) throw error;
      return data.user?.id ?? null;
    },
    async getMemberships(userId) {
      const { data, error } = await remote.from('family_members')
        .select('family_id,user_id,member_email,role,created_at')
        .eq('user_id', userId);
      if (error) throw error;
      return (data ?? []) as FamilyMember[];
    },
    async getFamily(familyId) {
      const { data, error } = await remote.from('families')
        .select('id,name,created_at,updated_at,created_by,sync_revision')
        .eq('id', familyId)
        .single();
      if (error) throw error;
      if (!data || typeof data.sync_revision !== 'number') {
        throw new Error('Tennis Tracker Cloud non espone lo stato di sincronizzazione richiesto.');
      }
      return data as RemoteFamily;
    },
    async createFamily(localFamilyId, name) {
      const { data, error } = await remote.rpc('create_family', { _id: localFamilyId, _name: name });
      if (error) throw error;
      if (typeof data !== 'string') {
        logTechnicalDiagnostic('cloud-family-creation', 'invalid-create-family-response');
        throw new Error(normalizeUiError('sync'));
      }
      return data;
    },
    async beginInitialSnapshot(familyId) {
      const { data, error } = await remote.rpc('begin_initial_snapshot', { _family_id: familyId });
      if (error) throw error;
      const revision = typeof data === 'number' ? data : typeof data === 'string' ? Number(data) : NaN;
      if (!Number.isSafeInteger(revision) || revision < 0) {
        logTechnicalDiagnostic('cloud-snapshot-validation', 'invalid-snapshot-revision');
        throw new Error(normalizeUiError('sync'));
      }
      return revision;
    },
    async listSnapshot(entityType, familyId, revision, afterId, limit) {
      const { data, error } = await remote.rpc('list_initial_snapshot', {
        _family_id: familyId,
        _snapshot_revision: revision,
        _entity_type: entityType,
        _after_id: afterId || '00000000-0000-0000-0000-000000000000',
        _limit: limit,
      });
      if (error) throw error;
      if (!Array.isArray(data)) {
        logTechnicalDiagnostic('cloud-snapshot-validation', 'invalid-snapshot-page');
        throw new Error(normalizeUiError('sync'));
      }
      return data as unknown as Record<string, unknown>[];
    },
    async applyRecord({ familyId, operationId, entityType, entityId, baseVersion, payload }) {
      const { data, error } = await remote.rpc('apply_sync_record', {
        _family_id: familyId,
        _operation_id: operationId,
        _entity_type: entityType,
        _entity_id: entityId,
        _base_version: baseVersion,
        _payload: payload,
      });
      if (error) throw error;
      return validateApplyResult(data);
    },
    async pullChanges(familyId, afterRevision, limit) {
      const { data, error } = await remote.rpc('pull_sync_changes', {
        _family_id: familyId,
        _after_revision: afterRevision,
        _limit: limit,
      });
      if (error) throw error;
      return validateChanges(data);
    },
  };
}

// Parents before children: a club before its tournaments, a player and a tournament before their matches.
export const syncEntityOrder: SyncEntityType[] = ['players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'];

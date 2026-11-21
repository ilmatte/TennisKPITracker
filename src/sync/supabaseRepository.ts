import type { SupabaseClient } from '@supabase/supabase-js';
import type { FamilyMember, SyncEntityType } from '../types';
import { supabase } from '../services/supabase/client';
import type {
  ApplyRecordResult,
  RemoteChange,
  RemoteFamily,
  SyncRepository,
} from './contracts';

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Supabase non è configurato.');
  return client;
}

function validateApplyResult(value: unknown): ApplyRecordResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Risposta non valida dal protocollo di sincronizzazione.');
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
  throw new Error('Risposta incompleta dal protocollo di sincronizzazione.');
}

function validateChanges(value: unknown): { changes: RemoteChange[]; nextRevision: number } {
  if (!value || typeof value !== 'object') {
    throw new Error('Risposta non valida durante il download incrementale.');
  }
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.changes) || typeof result.next_revision !== 'number') {
    throw new Error('Risposta incompleta durante il download incrementale.');
  }
  const changes = result.changes.map((item): RemoteChange => {
    if (!item || typeof item !== 'object') throw new Error('Elemento non valido nel log di sincronizzazione.');
    const change = item as Record<string, unknown>;
    if (typeof change.revision !== 'number' ||
      !['players', 'matches', 'sets', 'games', 'points'].includes(String(change.entity_type)) ||
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
        throw new Error('La famiglia remota non espone il cursore di sincronizzazione; applica la migrazione 003.');
      }
      return data as RemoteFamily;
    },
    async createFamily(localFamilyId, name) {
      const { data, error } = await remote.rpc('create_family', { _id: localFamilyId, _name: name });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('La RPC create_family ha restituito una risposta non valida.');
      return data;
    },
    async listRecords(entityType, familyId, afterId, limit) {
      const { data, error } = await remote.from(entityType)
        .select('*')
        .eq('family_id', familyId)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    async applyRecord({ familyId, entityType, entityId, baseVersion, payload }) {
      const { data, error } = await remote.rpc('apply_sync_record', {
        _family_id: familyId,
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

export const syncEntityOrder: SyncEntityType[] = ['players', 'matches', 'sets', 'games', 'points'];

import type { SyncOperation } from '../types';

export const stamp = () => new Date().toISOString();

export function mutationError(cause: unknown, fallback: string, conflict: string): string {
  if (cause instanceof Error && cause.name === 'ConstraintError') return conflict;
  return cause instanceof Error ? cause.message : fallback;
}

export function queueOperation<T>(family_id: string, entity_type: SyncOperation['entity_type'], entity: T & { id: string }, created_at: string): SyncOperation {
  return { id: crypto.randomUUID(), family_id, entity_type, entity_id: entity.id, operation: 'upsert', payload: entity, created_at, attempts: 0 };
}

import { db } from '../db/database';
import type { SyncMapping, SyncMetadata, SyncRecordBaseline } from '../types';

export const SYNC_STATE_KEY = 'sync-state';

export function baselineKey(entityType: string, entityId: string): string {
  return `record:${entityType}:${entityId}`;
}

export async function readSyncMapping(): Promise<SyncMapping | null> {
  const record = await db.syncMetadata.get(SYNC_STATE_KEY);
  return record?.value.kind === 'mapping' ? record.value : null;
}

export async function saveSyncMapping(mapping: SyncMapping): Promise<void> {
  const metadata: SyncMetadata = {
    key: SYNC_STATE_KEY,
    value: mapping,
    updated_at: new Date().toISOString(),
  };
  await db.syncMetadata.put(metadata);
}

export async function readRecordBaseline(entityType: string, entityId: string): Promise<SyncRecordBaseline | null> {
  const record = await db.syncMetadata.get(baselineKey(entityType, entityId));
  return record?.value.kind === 'record-baseline' ? record.value : null;
}

export async function writeRecordBaseline(
  entityType: SyncRecordBaseline['entity_type'],
  entityId: string,
  remoteVersion: number,
): Promise<void> {
  await db.syncMetadata.put({
    key: baselineKey(entityType, entityId),
    value: { kind: 'record-baseline', entity_type: entityType, entity_id: entityId, remote_version: remoteVersion },
    updated_at: new Date().toISOString(),
  });
}

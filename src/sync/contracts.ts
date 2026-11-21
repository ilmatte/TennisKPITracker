import type {
  Family,
  FamilyMember,
  SyncEntityType,
  SyncMapping,
} from '../types';

export interface RemoteFamily extends Pick<Family, 'id' | 'name' | 'created_at' | 'updated_at' | 'created_by'> {
  sync_revision: number;
}

export interface RemoteChange {
  revision: number;
  entity_type: SyncEntityType;
  entity_id: string;
  payload: Record<string, unknown>;
}

export type ApplyRecordResult =
  | { status: 'applied'; remote_version: number; revision: number; record: Record<string, unknown> }
  | {
      status: 'conflict';
      reason?: 'version' | 'constraint';
      remote_version: number;
      record: Record<string, unknown> | null;
    };

export interface SyncRepository {
  getAuthenticatedUserId(): Promise<string | null>;
  getMemberships(userId: string): Promise<FamilyMember[]>;
  getFamily(familyId: string): Promise<RemoteFamily>;
  createFamily(localFamilyId: string, name: string): Promise<string>;
  listRecords(entityType: SyncEntityType, familyId: string, afterId: string, limit: number): Promise<Record<string, unknown>[]>;
  applyRecord(input: {
    familyId: string;
    entityType: SyncEntityType;
    entityId: string;
    baseVersion: number;
    payload: Record<string, unknown>;
  }): Promise<ApplyRecordResult>;
  pullChanges(familyId: string, afterRevision: number, limit: number): Promise<{
    changes: RemoteChange[];
    nextRevision: number;
  }>;
}

export interface ProvisionedSync {
  mapping: SyncMapping;
  family: RemoteFamily;
}

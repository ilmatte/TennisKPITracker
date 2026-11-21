import { db } from '../db/database';
import type { Table } from 'dexie';
import type {
  Game,
  Match,
  Player,
  Point,
  SyncConflict,
  SyncEntityType,
  SyncMapping,
  SyncOperation,
  SyncLease,
  SyncMetadata,
  TennisSet,
} from '../types';
import type { RemoteChange, SyncRepository } from './contracts';
import { readRecordBaseline, saveSyncMapping, writeRecordBaseline } from './syncState';
import { syncEntityOrder } from './supabaseRepository';

const PAGE_SIZE = 200;
const INITIAL_COMPLETE = '__complete__';
const LEASE_DURATION_MS = 60_000;
const LEASE_RENEWAL_MS = 15_000;
const runLocks = new Map<string, Promise<SyncResult>>();
type SportsRecord = Player | Match | TennisSet | Game | Point;

export interface SyncResult {
  status: SyncMapping['status'];
  uploaded: number;
  downloaded: number;
  conflicts: SyncConflict[];
  pending: number;
}

function storeFor(type: SyncEntityType): Table {
  switch (type) {
    case 'players': return db.players;
    case 'matches': return db.matches;
    case 'sets': return db.sets;
    case 'games': return db.games;
    case 'points': return db.points;
  }
}

class SyncLockTimeoutError extends Error {
  constructor() {
    super('Un’altra scheda sta già sincronizzando questo workspace. Riprova tra poco.');
    this.name = 'SyncLockTimeoutError';
  }
}

async function withIndexedDbLease<T>(localFamilyId: string, operation: () => Promise<T>): Promise<T> {
  const key = `sync-lock:${localFamilyId}`;
  const ownerId = crypto.randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 140; attempt++) {
    await db.transaction('rw', db.syncMetadata, async () => {
      const current = await db.syncMetadata.get(key);
      const activeLease = current?.value.kind === 'sync-lease' &&
        current.value.expires_at > Date.now();
      if (!activeLease) {
        const lease: SyncLease = { kind: 'sync-lease', owner_id: ownerId, expires_at: Date.now() + LEASE_DURATION_MS };
        const record: SyncMetadata = { key, value: lease, updated_at: new Date().toISOString() };
        await db.syncMetadata.put(record);
        acquired = true;
      }
    });
    if (acquired) break;
    await new Promise(resolve => window.setTimeout(resolve, 500));
  }
  if (!acquired) throw new SyncLockTimeoutError();

  let leaseLost = false;
  let leaseError: unknown;
  let renewalTimer: number;
  const renew = async () => {
    try {
      await db.transaction('rw', db.syncMetadata, async () => {
        const current = await db.syncMetadata.get(key);
        if (current?.value.kind !== 'sync-lease' || current.value.owner_id !== ownerId) {
          leaseLost = true;
          return;
        }
        const lease: SyncLease = { kind: 'sync-lease', owner_id: ownerId, expires_at: Date.now() + LEASE_DURATION_MS };
        await db.syncMetadata.put({ key, value: lease, updated_at: new Date().toISOString() });
      });
    } catch (cause) {
      leaseLost = true;
      leaseError = cause;
    }
    if (!leaseLost) renewalTimer = window.setTimeout(() => { void renew(); }, LEASE_RENEWAL_MS);
  };
  renewalTimer = window.setTimeout(() => { void renew(); }, LEASE_RENEWAL_MS);
  try {
    const result = await operation();
    if (leaseLost) {
      throw new Error('Il lock locale di sincronizzazione è stato perso; verifica lo stato prima di riprovare.', {
        cause: leaseError,
      });
    }
    return result;
  } finally {
    window.clearTimeout(renewalTimer);
    await db.transaction('rw', db.syncMetadata, async () => {
      const current = await db.syncMetadata.get(key);
      if (current?.value.kind === 'sync-lease' && current.value.owner_id === ownerId) {
        await db.syncMetadata.delete(key);
      }
    });
  }
}

async function withSyncLock<T>(localFamilyId: string, operation: () => Promise<T>): Promise<T> {
  const lockName = `tennis-kpi-sync:${localFamilyId}`;
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request(lockName, { mode: 'exclusive' }, operation);
  }
  return withIndexedDbLease(localFamilyId, operation);
}

function allSportsStores() {
  return [db.players, db.matches, db.sets, db.games, db.points];
}

function getVersion(payload: unknown): number {
  if (!payload || typeof payload !== 'object' || !('version' in payload) ||
    typeof payload.version !== 'number') return 0;
  return payload.version;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .filter(([key]) => !['family_id', 'version', 'created_at', 'updated_at'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toLocalPayload(payload: Record<string, unknown>, mapping: SyncMapping): Record<string, unknown> {
  if (payload.family_id !== mapping.remote_family_id) {
    throw new Error('Il record scaricato appartiene a una famiglia remota diversa dal mapping attivo.');
  }
  if (typeof payload.id !== 'string' || typeof payload.version !== 'number' ||
    typeof payload.deleted !== 'boolean') {
    throw new Error('Il record remoto non rispetta il contratto dati di sincronizzazione.');
  }
  return { ...payload, family_id: mapping.local_family_id };
}

function queuedFor(type: SyncEntityType, id: string, localFamilyId: string): Promise<SyncOperation[]> {
  return db.syncQueue.where('entity_id').equals(id)
    .filter(operation => operation.entity_type === type && operation.family_id === localFamilyId)
    .toArray();
}

async function unresolvedConflict(type: SyncEntityType, id: string, familyId: string): Promise<SyncConflict | undefined> {
  return db.syncConflicts.where('entity_id').equals(id)
    .filter(conflict => conflict.entity_type === type)
    .filter(conflict => conflict.family_id === familyId && conflict.status === 'unresolved')
    .first();
}

function makeConflict(
  mapping: SyncMapping,
  type: SyncEntityType,
  id: string,
  baseVersion: number,
  localPayload: unknown,
  remotePayload: unknown | null,
  remoteVersion: number,
  reason: SyncConflict['reason'] = 'version',
): SyncConflict {
  return {
    id: crypto.randomUUID(),
    family_id: mapping.local_family_id,
    entity_type: type,
    entity_id: id,
    base_version: baseVersion,
    reason,
    local_payload: localPayload,
    remote_payload: remotePayload,
    remote_version: remoteVersion,
    status: 'unresolved',
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
}

async function applyRemoteRecord(
  mapping: SyncMapping,
  type: SyncEntityType,
  remotePayload: Record<string, unknown>,
): Promise<'applied' | 'ignored' | 'conflict'> {
  const localPayload = toLocalPayload(remotePayload, mapping);
  const id = String(localPayload.id);
  const version = Number(localPayload.version);
  const store = storeFor(type);
  const baseline = await readRecordBaseline(type, id);
  const current = await store.get(id) as SportsRecord | undefined;
  if (current && current.family_id !== mapping.local_family_id) {
    throw new Error(`L’ID ${id} esiste già in un altro workspace locale; nessun dato è stato sovrascritto.`);
  }
  if (baseline && version <= baseline.remote_version) return 'ignored';

  const pending = await queuedFor(type, id, mapping.local_family_id);
  const existingConflict = await unresolvedConflict(type, id, mapping.local_family_id);
  if (existingConflict) {
    await db.syncConflicts.update(existingConflict.id, {
      remote_payload: localPayload,
      remote_version: version,
    });
    return 'conflict';
  }

  if (pending.length || (current && !baseline)) {
    const acknowledgedOperation = pending
      .filter(operation => canonical(operation.payload) === canonical(localPayload))
      .reduce<SyncOperation | undefined>(
        (latest, operation) => !latest || getVersion(operation.payload) > getVersion(latest.payload)
          ? operation
          : latest,
        undefined,
      );
    if (acknowledgedOperation) {
      const acknowledgedVersion = getVersion(acknowledgedOperation.payload);
      await db.transaction('rw', [store, db.syncMetadata, db.syncQueue], async () => {
        if (!current || current.version <= acknowledgedVersion) await store.put(localPayload);
        await writeRecordBaseline(type, id, version);
        const entries = await queuedFor(type, id, mapping.local_family_id);
        await db.syncQueue.bulkDelete(entries
          .filter(operation => getVersion(operation.payload) <= acknowledgedVersion)
          .map(operation => operation.id));
      });
      return 'applied';
    }

    const latestPending = pending.reduce<SyncOperation | undefined>(
      (latest, operation) => !latest || getVersion(operation.payload) > getVersion(latest.payload) ? operation : latest,
      undefined,
    );
    const localData = current ?? latestPending?.payload;
    if (localData && canonical(localData) === canonical(localPayload)) {
      await db.transaction('rw', [store, db.syncMetadata, db.syncQueue], async () => {
        await store.put(localPayload);
        await writeRecordBaseline(type, id, version);
        const entries = await queuedFor(type, id, mapping.local_family_id);
        await db.syncQueue.bulkDelete(entries
          .filter(operation => getVersion(operation.payload) <= getVersion(localData))
          .map(operation => operation.id));
      });
      return 'applied';
    }

    const conflict = makeConflict(
      mapping, type, id, baseline?.remote_version ?? 0, localData ?? null, localPayload, version,
    );
    await db.syncConflicts.add(conflict);
    return 'conflict';
  }

  await db.transaction('rw', [store, db.syncMetadata], async () => {
    await store.put(localPayload);
    await writeRecordBaseline(type, id, version);
  });
  return 'applied';
}

async function applyInitialPage(
  mapping: SyncMapping,
  type: SyncEntityType,
  rows: Record<string, unknown>[],
  nextCursor: string,
): Promise<number> {
  let downloaded = 0;
  await db.transaction('rw', [...allSportsStores(), db.syncQueue, db.syncMetadata, db.syncConflicts], async () => {
    for (const row of rows) {
      const result = await applyRemoteRecord(mapping, type, row);
      if (result === 'applied') downloaded++;
    }
    const cursors = { ...mapping.initial_download_cursors, [type]: nextCursor };
    const nextMapping = { ...mapping, initial_download_cursors: cursors, updated_at: new Date().toISOString() };
    await saveSyncMapping(nextMapping);
    Object.assign(mapping, nextMapping);
  });
  return downloaded;
}

async function downloadInitial(
  repository: SyncRepository,
  mapping: SyncMapping,
  familyRevision: number,
): Promise<number> {
  let downloaded = 0;
  if (!mapping.initial_download_started) {
    mapping.initial_download_started = true;
    mapping.initial_download_revision = await repository.beginInitialSnapshot(mapping.remote_family_id!);
    mapping.initial_download_cursors = {};
    mapping.updated_at = new Date().toISOString();
    await saveSyncMapping(mapping);
  }

  for (const type of syncEntityOrder) {
    let cursor = mapping.initial_download_cursors[type] ?? '';
    while (cursor !== INITIAL_COMPLETE) {
      const rows = await repository.listSnapshot(
        type,
        mapping.remote_family_id!,
        mapping.initial_download_revision!,
        cursor,
        PAGE_SIZE,
      );
      const nextCursor = rows.length < PAGE_SIZE
        ? INITIAL_COMPLETE
        : String(rows[rows.length - 1].id);
      downloaded += await applyInitialPage(mapping, type, rows, nextCursor);
      cursor = nextCursor;
    }
  }

  mapping.initial_download_complete = true;
  mapping.download_revision = mapping.initial_download_revision ?? familyRevision;
  mapping.last_download_completed_at = new Date().toISOString();
  mapping.updated_at = new Date().toISOString();
  await saveSyncMapping(mapping);
  return downloaded;
}

async function applyChangePage(
  mapping: SyncMapping,
  changes: RemoteChange[],
  nextRevision: number,
): Promise<{ downloaded: number; conflicts: SyncConflict[] }> {
  let downloaded = 0;
  const conflicts: SyncConflict[] = [];
  await db.transaction('rw', [...allSportsStores(), db.syncQueue, db.syncMetadata, db.syncConflicts], async () => {
    for (const change of changes) {
      const outcome = await applyRemoteRecord(mapping, change.entity_type, change.payload);
      if (outcome === 'applied') downloaded++;
      if (outcome === 'conflict') {
        const conflict = await unresolvedConflict(change.entity_type, change.entity_id, mapping.local_family_id);
        if (conflict) conflicts.push(conflict);
      }
    }
    mapping.download_revision = nextRevision;
    mapping.last_download_completed_at = new Date().toISOString();
    mapping.updated_at = new Date().toISOString();
    await saveSyncMapping(mapping);
  });
  return { downloaded, conflicts };
}

async function downloadChanges(
  repository: SyncRepository,
  mapping: SyncMapping,
): Promise<{ downloaded: number; conflicts: SyncConflict[] }> {
  let downloaded = 0;
  const conflicts: SyncConflict[] = [];
  for (;;) {
    const page = await repository.pullChanges(mapping.remote_family_id!, mapping.download_revision, PAGE_SIZE);
    if (!page.changes.length) {
      if (page.nextRevision !== mapping.download_revision) {
        throw new Error('Il cursore incrementale è avanzato senza record: sincronizzazione sospesa per evitare salti.');
      }
      break;
    }
    let expectedRevision = mapping.download_revision;
    for (const change of page.changes) {
      expectedRevision++;
      if (change.revision !== expectedRevision) {
        throw new Error('Il log remoto contiene un salto di revisione; il cursore locale non è stato avanzato.');
      }
    }
    const lastRevision = page.changes[page.changes.length - 1].revision;
    if (page.nextRevision !== lastRevision || lastRevision <= mapping.download_revision) {
      throw new Error('Il server ha restituito un cursore incrementale non monotono.');
    }
    const result = await applyChangePage(mapping, page.changes, page.nextRevision);
    downloaded += result.downloaded;
    conflicts.push(...result.conflicts);
    if (page.changes.length < PAGE_SIZE) break;
  }
  return { downloaded, conflicts };
}

async function hasBlockedDependency(type: SyncEntityType, payload: SportsRecord, familyId: string): Promise<boolean> {
  const dependency = type === 'matches' ? ['players', (payload as Match).player_id]
    : type === 'sets' ? ['matches', (payload as TennisSet).match_id]
      : type === 'games' ? ['sets', (payload as Game).set_id]
        : type === 'points' ? ['games', (payload as Point).game_id]
          : null;
  if (!dependency) return false;
  return Boolean(await unresolvedConflict(dependency[0] as SyncEntityType, dependency[1] as string, familyId));
}

async function uploadPending(repository: SyncRepository, mapping: SyncMapping): Promise<number> {
  let uploaded = 0;
  for (const type of syncEntityOrder) {
    const pending = await db.syncQueue.where('family_id').equals(mapping.local_family_id)
      .filter(operation => operation.entity_type === type).toArray();
    const ids = [...new Set(pending.map(operation => operation.entity_id))];
    for (const id of ids) {
      if (await unresolvedConflict(type, id, mapping.local_family_id)) continue;
      const localRecord = await storeFor(type).get(id) as SportsRecord | undefined;
      if (!localRecord || localRecord.family_id !== mapping.local_family_id) {
        throw new Error(`Operazione in coda senza record locale coerente: ${type}/${id}.`);
      }
      if (pending.some(operation => operation.entity_id === id && operation.operation === 'delete') &&
        !localRecord.deleted) {
        throw new Error(`Operazione delete non valida per ${type}/${id}; le cancellazioni devono essere tombstone upsert.`);
      }
      if (await hasBlockedDependency(type, localRecord, mapping.local_family_id)) continue;

      const baseline = await readRecordBaseline(type, id);
      const operation = pending
        .filter(item => item.entity_id === id)
        .reduce<SyncOperation | undefined>((latest, item) => {
          if (!latest) return item;
          const latestVersion = getVersion(latest.payload);
          const itemVersion = getVersion(item.payload);
          if (itemVersion !== latestVersion) return itemVersion > latestVersion ? item : latest;
          return item.created_at > latest.created_at ? item : latest;
        }, undefined);
      const operationId = operation?.operation_id ?? operation?.id;
      if (!operationId) throw new Error(`Operazione in coda senza identificatore persistente: ${type}/${id}.`);
      const result = await repository.applyRecord({
        familyId: mapping.remote_family_id!,
        operationId,
        entityType: type,
        entityId: id,
        baseVersion: baseline?.remote_version ?? 0,
        payload: localRecord as unknown as Record<string, unknown>,
      });
      if (result.status === 'conflict') {
        const conflict = makeConflict(
          mapping,
          type,
          id,
          baseline?.remote_version ?? 0,
          localRecord,
          result.record ? { ...result.record, family_id: mapping.local_family_id } : null,
          result.remote_version,
          result.reason ?? 'version',
        );
        await db.syncConflicts.add(conflict);
        continue;
      }

      const sentVersion = localRecord.version;
      await db.transaction('rw', [storeFor(type), db.syncQueue, db.syncMetadata], async () => {
        await writeRecordBaseline(type, id, result.remote_version);
        const operations = await queuedFor(type, id, mapping.local_family_id);
        await db.syncQueue.bulkDelete(operations
          .filter(operation => {
            const operationPayloadVersion = getVersion(operation.payload);
            const operationIdentity = operation.operation_id ?? operation.id;
            return operationIdentity === operationId || operationPayloadVersion < sentVersion;
          })
          .map(operation => operation.id));
      });
      uploaded++;
    }
  }
  return uploaded;
}

async function runSyncOnce(
  repository: SyncRepository,
  mapping: SyncMapping,
  familyRevision: number,
): Promise<SyncResult> {
  mapping.status = 'syncing';
  mapping.last_error = null;
  mapping.next_retry_at = null;
  mapping.updated_at = new Date().toISOString();
  await saveSyncMapping(mapping);

  let downloaded = 0;
  const conflicts: SyncConflict[] = [];
  if (!mapping.initial_download_complete) {
    downloaded += await downloadInitial(repository, mapping, familyRevision);
  }
  const incremental = await downloadChanges(repository, mapping);
  downloaded += incremental.downloaded;
  conflicts.push(...incremental.conflicts);

  const uploaded = await uploadPending(repository, mapping);
  const afterUpload = await downloadChanges(repository, mapping);
  downloaded += afterUpload.downloaded;
  conflicts.push(...afterUpload.conflicts);

  const pending = await db.syncQueue.where('family_id').equals(mapping.local_family_id).count();
  const openConflicts = await db.syncConflicts.where('family_id').equals(mapping.local_family_id)
    .filter(conflict => conflict.status === 'unresolved').toArray();
  mapping.status = openConflicts.length
    ? 'needs-attention'
    : pending > 0 ? 'offline-pending' : 'synced';
  mapping.retry_count = 0;
  mapping.next_retry_at = null;
  mapping.last_upload_completed_at = new Date().toISOString();
  mapping.updated_at = new Date().toISOString();
  await saveSyncMapping(mapping);
  return { status: mapping.status, uploaded, downloaded, conflicts: openConflicts, pending };
}

export async function runSync(
  repository: SyncRepository,
  mapping: SyncMapping,
  familyRevision: number,
): Promise<SyncResult> {
  const existing = runLocks.get(mapping.local_family_id);
  if (existing) return existing;
  const running = withSyncLock(mapping.local_family_id, () => runSyncOnce(repository, mapping, familyRevision));
  runLocks.set(mapping.local_family_id, running);
  try {
    return await running;
  } finally {
    if (runLocks.get(mapping.local_family_id) === running) runLocks.delete(mapping.local_family_id);
  }
}

export function isRecoverableSyncError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number(error.status);
    return status === 0 || status === 429 || status >= 500;
  }
  if (error instanceof TypeError || error instanceof DOMException) return true;
  return error instanceof Error &&
    (error.name === 'SyncLockTimeoutError' || /network|fetch|timeout|connection/i.test(error.message));
}

export async function markSyncFailure(mapping: SyncMapping, error: unknown): Promise<void> {
  const recoverable = isRecoverableSyncError(error);
  const retryCount = mapping.retry_count + 1;
  const delaySeconds = Math.min(60 * 60, 2 ** Math.min(retryCount, 10));
  mapping.status = recoverable ? 'retryable-error' : 'permanent-error';
  mapping.last_error = error instanceof Error ? error.message : 'Errore sconosciuto durante la sincronizzazione.';
  mapping.retry_count = retryCount;
  mapping.next_retry_at = recoverable
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : null;
  mapping.updated_at = new Date().toISOString();
  await saveSyncMapping(mapping);
}

export async function recordQueueFailure(localFamilyId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Errore sconosciuto durante la sincronizzazione.';
  await db.transaction('rw', db.syncQueue, async () => {
    await db.syncQueue.where('family_id').equals(localFamilyId).modify(operation => {
      operation.attempts++;
      operation.last_error = message;
    });
  });
}

export async function resolveSyncConflict(
  conflictId: string,
  choice: 'local' | 'remote',
): Promise<void> {
  const conflict = await db.syncConflicts.get(conflictId);
  if (!conflict || conflict.status !== 'unresolved') throw new Error('Il conflitto non è più disponibile.');
  const store = storeFor(conflict.entity_type);
  const mapping = await db.syncMetadata.get('sync-state');
  if (!mapping || mapping.value.kind !== 'mapping') throw new Error('Mapping di sincronizzazione mancante.');
  const syncMapping = mapping.value;
  const remotePayload = conflict.remote_payload as Record<string, unknown> | null;
  await db.transaction('rw', [store, db.syncQueue, db.syncMetadata, db.syncConflicts], async () => {
    if (choice === 'remote') {
      if (conflict.reason === 'constraint') {
        throw new Error('Un vincolo locale impedisce l’uso della versione remota; modifica il record in conflitto e riprova.');
      }
      if (!remotePayload) throw new Error('La versione remota del conflitto non esiste.');
      if (typeof remotePayload.id !== 'string' || typeof remotePayload.version !== 'number' ||
        typeof remotePayload.deleted !== 'boolean') {
        throw new Error('La versione remota del conflitto non è valida.');
      }
      await store.put({
        ...remotePayload,
        family_id: syncMapping.local_family_id,
      });
      const operations = await queuedFor(conflict.entity_type, conflict.entity_id, conflict.family_id);
      await db.syncQueue.bulkDelete(operations.map(operation => operation.id));
    } else if (conflict.reason === 'constraint') {
      const current = await store.get(conflict.entity_id) as SportsRecord | undefined;
      if (!current || canonical(current) === canonical(conflict.local_payload)) {
        throw new Error('Correggi prima il dato locale in conflitto, poi scegli di riprovare la versione locale.');
      }
    }
    await writeRecordBaseline(conflict.entity_type, conflict.entity_id, conflict.remote_version);
    await db.syncConflicts.update(conflict.id, { status: 'resolved', resolved_at: new Date().toISOString() });
  });
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import type { SyncConflict, SyncMapping } from '../types';
import type { SyncResult } from './syncEngine';
import {
  isRecoverableSyncError,
  markSyncFailure,
  recordQueueFailure,
  resolveSyncConflict,
  runSync,
} from './syncEngine';
import { provisionSync, recordOfflineActivation } from './provisioning';
import { createSupabaseSyncRepository } from './supabaseRepository';
import { readSyncMapping, saveSyncMapping, SYNC_STATE_KEY } from './syncState';
import type { ProvisionedSync, SyncRepository } from './contracts';
import { SyncContext, type SyncContextValue } from './SyncContextDefinition';

const EMPTY_CONFLICTS: SyncConflict[] = [];

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function makeDisabledState(localFamilyId: string, userId: string): SyncMapping {
  const updated_at = new Date().toISOString();
  return {
    kind: 'mapping',
    local_family_id: localFamilyId,
    remote_family_id: null,
    user_id: userId,
    role: null,
    enabled: false,
    status: 'signed-in-disabled',
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
    updated_at,
  };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activeFamily, acceptInvitation } = useFamily();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const metadata = useLiveQuery(() => db.syncMetadata.get(SYNC_STATE_KEY), []);
  const mapping = metadata?.value.kind === 'mapping' ? metadata.value : null;
  const pendingCount = useLiveQuery(() => activeFamily
    ? db.syncQueue.where('family_id').equals(activeFamily.id).count()
    : Promise.resolve(0), [activeFamily?.id]) ?? 0;
  const storedConflicts = useLiveQuery(async () => activeFamily
    ? db.syncConflicts.where('family_id').equals(activeFamily.id)
      .filter(conflict => conflict.status === 'unresolved').toArray()
    : EMPTY_CONFLICTS, [activeFamily?.id]);
  const conflicts = storedConflicts ?? EMPTY_CONFLICTS;
  const actionRef = useRef<() => Promise<SyncResult | null>>(async () => null);
  const autoSyncRef = useRef<() => void>(() => undefined);
  const previousPendingRef = useRef<number | null>(null);
  const rerunAfterBusyRef = useRef(false);

  const performSync = useCallback(async (explicit: boolean): Promise<SyncResult | null> => {
    if (!activeFamily) {
      if (explicit) setActionError('Lo spazio locale non è ancora pronto.');
      return null;
    }
    if (!user) {
      if (explicit) setActionError('Accedi con Google prima di attivare la sincronizzazione.');
      return null;
    }
    let stored: SyncMapping | null;
    try {
      stored = await readSyncMapping();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Impossibile leggere lo stato di sincronizzazione locale.');
      return null;
    }
    if (stored?.enabled && stored.user_id && stored.user_id !== user.id) {
      setActionError('La sincronizzazione è associata a un altro account. Accedi con l’account corretto prima di procedere.');
      return null;
    }
    if (!explicit && (!stored?.enabled || stored.user_id !== user.id)) return null;
    if (!isOnline()) {
      try {
        if (explicit && stored?.enabled && stored.user_id === user.id) {
          await saveSyncMapping({
            ...stored,
            status: 'offline-pending',
            last_error: 'La sincronizzazione è in attesa di connessione.',
            updated_at: new Date().toISOString(),
          });
        } else if (explicit) {
          await recordOfflineActivation(activeFamily, user.id);
        } else if (stored) {
          await saveSyncMapping({
            ...stored,
            status: 'offline-pending',
            last_error: 'Le modifiche locali sono in attesa di connessione.',
            updated_at: new Date().toISOString(),
          });
        }
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : 'Impossibile salvare lo stato offline.');
      }
      return null;
    }
    if (stored?.status === 'needs-attention' && !stored.enabled) {
      setActionError(stored.last_error ?? 'È necessaria una scelta esplicita prima di sincronizzare.');
      return null;
    }

    setBusy(true);
    setActionError(null);
    let activeMapping = stored;
    try {
      const repository: SyncRepository = createSupabaseSyncRepository();
      const authenticatedUserId = await repository.getAuthenticatedUserId();
      if (authenticatedUserId !== user.id) {
        throw new Error('La session Supabase non corrisponde all’account autenticato nell’app.');
      }
      let provisioned: ProvisionedSync;
      if (activeMapping?.enabled && activeMapping.user_id === user.id && activeMapping.remote_family_id) {
        const memberships = await repository.getMemberships(user.id);
        if (memberships.length !== 1) {
          throw new Error('Il mapping attivo non è univoco rispetto alle membership remote dell’account.');
        }
        const membership = memberships.find(item => item.family_id === activeMapping?.remote_family_id);
        if (!membership || membership.role !== activeMapping.role) {
          throw new Error('La membership remota è cambiata o non è più disponibile.');
        }
        const family = await repository.getFamily(activeMapping.remote_family_id);
        provisioned = { mapping: activeMapping, family };
      } else {
        const pending = activeMapping?.user_id === user.id && activeMapping.enabled
          ? activeMapping
          : await recordOfflineActivation(activeFamily, user.id);
        pending.status = 'syncing';
        pending.last_error = null;
        pending.updated_at = new Date().toISOString();
        await saveSyncMapping(pending);
        activeMapping = pending;
        const result = await provisionSync(repository, activeFamily, user.id);
        if ('needsAttention' in result) {
          setActionError(result.mapping.last_error);
          return null;
        }
        provisioned = result;
      }

      activeMapping = provisioned.mapping;
      if (provisioned.mapping.local_family_id !== activeFamily.id) {
        throw new Error('Il mapping remoto non corrisponde al workspace locale.');
      }
      const result = await runSync(repository, provisioned.mapping, provisioned.family.sync_revision);
      if (result.conflicts.length) {
        setActionError(`${result.conflicts.length} conflitto/i richiedono una risoluzione esplicita.`);
      }
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sincronizzazione non riuscita.';
      setActionError(message);
      await recordQueueFailure(activeFamily.id, cause);
      if (activeMapping) {
        await markSyncFailure(activeMapping, cause);
      } else if (explicit) {
        const pending = await recordOfflineActivation(activeFamily, user.id);
        pending.status = isRecoverableSyncError(cause) ? 'retryable-error' : 'permanent-error';
        pending.last_error = message;
        pending.retry_count = 1;
        pending.next_retry_at = isRecoverableSyncError(cause)
          ? new Date(Date.now() + 2000).toISOString()
          : null;
        await saveSyncMapping(pending);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [activeFamily, user]);

  const activate = useCallback(() => performSync(true), [performSync]);
  const syncNow = useCallback(() => performSync(false), [performSync]);

  const acceptInvitationAndSync = useCallback(async (token: string): Promise<'needs-attention' | 'synced' | 'pending'> => {
    const acceptedFamilyId = await acceptInvitation(token);
    await performSync(true);
    const current = await readSyncMapping();
    if (current?.remote_family_id && current.remote_family_id !== acceptedFamilyId) {
      throw new Error('L’invito è stato accettato, ma il mapping punta a una famiglia diversa. La sincronizzazione è sospesa.');
    }
    if (current?.status === 'needs-attention') return 'needs-attention';
    return current?.status === 'synced' ? 'synced' : 'pending';
  }, [acceptInvitation, performSync]);

  const resolveConflictAction = useCallback(async (id: string, choice: 'local' | 'remote') => {
    await resolveSyncConflict(id, choice);
    setActionError(null);
    const stored = await readSyncMapping();
    if (stored?.enabled) {
      await saveSyncMapping({
        ...stored,
        status: 'offline-pending',
        updated_at: new Date().toISOString(),
      });
      await performSync(false);
    }
  }, [performSync]);

  useEffect(() => {
    actionRef.current = syncNow;
    autoSyncRef.current = () => {
      if (busy) {
        rerunAfterBusyRef.current = true;
        return;
      }
      if (!mapping?.enabled || mapping.user_id !== user?.id || mapping.status === 'permanent-error') return;
      const nextRetry = mapping.next_retry_at ? Date.parse(mapping.next_retry_at) : 0;
      if (!nextRetry || nextRetry <= Date.now()) void actionRef.current();
    };
  }, [syncNow, busy, mapping, user?.id]);
  useEffect(() => {
    if (activeFamily && user && !mapping) {
      void db.syncMetadata.put({
        key: SYNC_STATE_KEY,
        value: makeDisabledState(activeFamily.id, user.id),
        updated_at: new Date().toISOString(),
      });
    }
  }, [activeFamily, user, mapping]);

  useEffect(() => {
    if (mapping?.enabled && mapping.user_id === user?.id && isOnline()) {
      const nextRetry = mapping.next_retry_at ? Date.parse(mapping.next_retry_at) : 0;
      if (!nextRetry || nextRetry <= Date.now()) autoSyncRef.current();
    }
  }, [mapping?.enabled, mapping?.user_id, mapping?.next_retry_at, user?.id]);

  useEffect(() => {
    if (mapping?.enabled && mapping.status === 'retryable-error' && mapping.next_retry_at) {
      const delay = Math.max(0, Date.parse(mapping.next_retry_at) - Date.now());
      const retryTimer = window.setTimeout(() => autoSyncRef.current(), delay);
      return () => window.clearTimeout(retryTimer);
    }
  }, [mapping?.enabled, mapping?.status, mapping?.next_retry_at]);

  useEffect(() => {
    const previous = previousPendingRef.current;
    previousPendingRef.current = pendingCount;
    if (previous !== null && pendingCount > previous &&
      mapping?.enabled && mapping.user_id === user?.id && isOnline()) {
      const timer = window.setTimeout(() => autoSyncRef.current(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [pendingCount, mapping?.enabled, mapping?.user_id, user?.id]);

  useEffect(() => {
    if (!busy && rerunAfterBusyRef.current) {
      rerunAfterBusyRef.current = false;
      const timer = window.setTimeout(() => autoSyncRef.current(), 150);
      return () => window.clearTimeout(timer);
    }
  }, [busy]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible' && isOnline()) autoSyncRef.current();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, []);

  const effectiveMapping = useMemo(() => mapping?.enabled && mapping.user_id !== user?.id
    ? { ...mapping, status: 'needs-attention' as const }
    : mapping, [mapping, user?.id]);
  const status = busy
    ? 'syncing'
    : effectiveMapping?.status === 'needs-attention'
      ? 'needs-attention'
      : effectiveMapping?.enabled && pendingCount > 0
        ? 'offline-pending'
        : effectiveMapping?.status ?? (user ? 'signed-in-disabled' : 'local-only');
  const value = useMemo<SyncContextValue>(() => ({
    mapping: effectiveMapping,
    status,
    busy,
    error: actionError ?? effectiveMapping?.last_error ?? null,
    conflicts,
    activate,
    syncNow,
    acceptInvitationAndSync,
    resolveConflict: resolveConflictAction,
  }), [
    effectiveMapping, status, busy, actionError, conflicts, activate, syncNow,
    acceptInvitationAndSync, resolveConflictAction,
  ]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

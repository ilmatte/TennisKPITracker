import { createContext, useContext } from 'react';
import type { SyncConflict, SyncMapping } from '../types';
import type { SyncResult } from './syncEngine';

export interface SyncContextValue {
  mapping: SyncMapping | null;
  status: SyncMapping['status'];
  busy: boolean;
  error: string | null;
  conflicts: SyncConflict[];
  activate: () => Promise<SyncResult | null>;
  syncNow: () => Promise<SyncResult | null>;
  acceptInvitationAndSync: (token: string) => Promise<'needs-attention' | 'synced' | 'pending'>;
  resolveConflict: (id: string, choice: 'local' | 'remote') => Promise<void>;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside SyncProvider.');
  return value;
}

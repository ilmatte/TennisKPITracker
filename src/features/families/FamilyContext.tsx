import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ensureLocalWorkspace } from '../../db/database';
import type { Family } from '../../types';
import { supabase } from '../../services/supabase/client';
import { useAuth } from '../auth/AuthContext';
import { FamilyContext, type FamilyContextValue } from './FamilyContextDefinition';

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeFamily, setActiveFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const workspace = await ensureLocalWorkspace();
      setActiveFamily(workspace);
    } catch (cause) {
      setActiveFamily(null);
      setError(cause instanceof Error ? cause.message : 'Impossibile inizializzare lo spazio locale.');
      setLoading(false);
      return;
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    ensureLocalWorkspace().then(workspace => {
      if (active) setActiveFamily(workspace);
    }).catch(cause => {
      if (!active) return;
      setActiveFamily(null);
      setError(cause instanceof Error ? cause.message : 'Impossibile inizializzare lo spazio locale.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const acceptInvitation = useCallback(async (token: string) => {
    if (!user || !supabase || !navigator.onLine) {
      throw new Error('Accedi e connettiti a internet per accettare l’invito.');
    }
    const { data, error: acceptError } = await supabase.rpc('accept_family_invitation', { _token: token.trim() });
    if (acceptError) throw acceptError;
    if (typeof data !== 'string') throw new Error('La RPC di accettazione invito ha restituito una famiglia non valida.');
    await refresh();
    return data;
  }, [refresh, user]);

  const value = useMemo<FamilyContextValue>(() => ({
    activeFamily, loading, error, refresh, acceptInvitation, setError,
  }), [activeFamily, loading, error, refresh, acceptInvitation]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, ensureLocalWorkspace } from '../../db/database';
import type { Family, FamilyMember } from '../../types';
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

    try {
      if (user && supabase && navigator.onLine) {
        const { data, error: membershipError } = await supabase
          .from('family_members')
          .select('family_id,user_id,member_email,role,created_at')
          .eq('user_id', user.id);
        if (membershipError) throw membershipError;
        const ownMemberships: FamilyMember[] = data ?? [];
        const familyIds = [...new Set(ownMemberships.map(member => member.family_id))];
        if (familyIds.length) {
          const { data: memberData, error: membersError } = await supabase
            .from('family_members')
            .select('family_id,user_id,member_email,role,created_at')
            .in('family_id', familyIds);
          if (membersError) throw membersError;
          await db.family_members.bulkPut(memberData ?? []);

          const { data: familyData, error: familiesError } = await supabase
            .from('families')
            .select('id,name,created_at,updated_at,created_by')
            .in('id', familyIds);
          if (familiesError) throw familiesError;
          const remoteFamilies = (familyData ?? []).map(family => ({ ...family, local_only: false }));
          await db.families.bulkPut(remoteFamilies);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile aggiornare i dati di condivisione.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const acceptInvitation = useCallback(async (token: string) => {
    if (!user || !supabase || !navigator.onLine) {
      throw new Error('Accedi e connettiti a internet per accettare l’invito.');
    }
    const { error: acceptError } = await supabase.rpc('accept_family_invitation', { _token: token.trim() });
    if (acceptError) throw acceptError;
    await refresh();
  }, [refresh, user]);

  const value = useMemo<FamilyContextValue>(() => ({
    activeFamily, loading, error, refresh, acceptInvitation, setError,
  }), [activeFamily, loading, error, refresh, acceptInvitation]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

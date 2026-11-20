import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, ensureLocalWorkspace, removeLocalFamily } from '../../db/database';
import type { Family, FamilyMember } from '../../types';
import { supabase } from '../../services/supabase/client';
import { useAuth } from '../auth/AuthContext';
import { FamilyContext, type FamilyContextValue } from './FamilyContextDefinition';

function activeFamilyStorageKey(userId: string | null) {
  return `tennis-kpi-active-family:${userId ?? 'offline'}`;
}

function storedFamilyId(userId: string | null) {
  try {
    return localStorage.getItem('tennis-kpi-active-workspace') ??
      localStorage.getItem(activeFamilyStorageKey(userId)) ??
      localStorage.getItem(activeFamilyStorageKey(null));
  } catch {
    return null;
  }
}

function defaultFamilyId(available: Family[]): string | null {
  const local = available
    .filter(family => family.local_only)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return local[0]?.id ?? available[0]?.id ?? null;
}

function resolveFamilyId(available: Family[], current: string | null, userId: string | null): string | null {
  const preferred = storedFamilyId(userId);
  if (preferred && available.some(family => family.id === preferred)) return preferred;
  return current && available.some(family => family.id === current)
    ? current
    : defaultFamilyId(available);
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [families, setFamilies] = useState<Family[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [activeFamilyId, setActiveFamilyId] = useState(() => storedFamilyId(user?.id ?? null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError(null);
    try {
      await ensureLocalWorkspace();
      const localFamilies = await db.families.toArray();
      const localWorkspaces = localFamilies.filter(family => family.local_only);
      setFamilies(localWorkspaces);
      setActiveFamilyId(current => resolveFamilyId(localWorkspaces, current, user?.id ?? null));
      if (!user || !supabase) {
        const available = localFamilies;
        setMembers([]);
        setFamilies(available);
        setActiveFamilyId(current => resolveFamilyId(available, current, null));
        return;
      }

      let memberRows: FamilyMember[] = [];
      if (navigator.onLine) {
        const { data, error: memberError } = await supabase
          .from('family_members')
          .select('family_id,user_id,member_email,role,created_at')
          .eq('user_id', user.id);
        if (memberError) throw memberError;
        const ownMemberships: FamilyMember[] = data ?? [];
        const familyIds = new Set(ownMemberships.map(member => member.family_id));
        if (familyIds.size) {
          const { data: allMembers, error: allMembersError } = await supabase
            .from('family_members')
            .select('family_id,user_id,member_email,role,created_at')
            .in('family_id', [...familyIds]);
          if (allMembersError) throw allMembersError;
          memberRows = allMembers ?? [];
          await db.family_members.bulkPut(memberRows);
        } else {
          memberRows = [];
        }
      } else {
        const ownMemberships = await db.family_members.where('user_id').equals(user.id).toArray();
        const familyIds = new Set(ownMemberships.map(member => member.family_id));
        memberRows = familyIds.size
          ? await db.family_members.where('family_id').anyOf([...familyIds]).toArray()
          : [];
      }
      const familyIds = new Set(memberRows.filter(member => member.user_id === user.id).map(member => member.family_id));
      const cachedCloudFamilies = localFamilies.filter(family => familyIds.has(family.id));
      let cloudFamilies = cachedCloudFamilies;
      if (navigator.onLine && familyIds.size) {
        const { data, error: familyError } = await supabase
          .from('families')
          .select('id,name,created_at,updated_at,created_by')
          .in('id', [...familyIds]);
        if (familyError) throw familyError;
        cloudFamilies = (data ?? []).map(family => ({ ...family, local_only: false }));
        await db.families.bulkPut(cloudFamilies);
      }
      const available = [...localWorkspaces, ...cloudFamilies];
      setFamilies(available);
      setMembers(memberRows);
      setActiveFamilyId(current => resolveFamilyId(available, current, user.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile caricare famiglie e membri.');
      const cached = await db.families.toArray();
      if (user) {
        const ownMemberships = await db.family_members.where('user_id').equals(user.id).toArray();
        const allowed = new Set(ownMemberships.map(member => member.family_id));
        const memberships = allowed.size
          ? await db.family_members.where('family_id').anyOf([...allowed]).toArray()
          : [];
        const available = [
          ...cached.filter(family => family.local_only),
          ...cached.filter(family => allowed.has(family.id)),
        ];
        setFamilies(available);
        setMembers(memberships);
        setActiveFamilyId(current => resolveFamilyId(available, current, user.id));
      } else {
        const available = cached;
        setFamilies(available);
        setMembers([]);
        setActiveFamilyId(current => resolveFamilyId(available, current, null));
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectFamily = useCallback((familyId: string) => {
    setActiveFamilyId(familyId);
    try {
      localStorage.setItem('tennis-kpi-active-workspace', familyId);
      localStorage.setItem(activeFamilyStorageKey(user?.id ?? null), familyId);
    } catch { /* Selection remains available for this session. */ }
  }, [user]);

  const createFamily = useCallback(async (name: string, localOnly: boolean) => {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error('Inserisci il nome della famiglia.');
    const now = new Date().toISOString();
    let family: Family;
    if (!localOnly && user && supabase && navigator.onLine) {
      const familyId = crypto.randomUUID();
      const { data, error: createError } = await supabase.rpc('create_family', { _id: familyId, _name: normalizedName });
      if (createError) throw createError;
      const returnedId = typeof data === 'string' ? data : Array.isArray(data) ? data[0] : data?.id;
      if (returnedId !== familyId) throw new Error('Il server non ha confermato l’ID della famiglia.');
      const { data: remoteFamily, error: familyError } = await supabase
        .from('families')
        .select('id,name,created_at,updated_at,created_by')
        .eq('id', familyId)
        .single();
      if (familyError) throw familyError;
      const { data: ownerMember, error: ownerError } = await supabase
        .from('family_members')
        .select('family_id,user_id,member_email,role,created_at')
        .eq('family_id', familyId)
        .eq('user_id', user.id)
        .single();
      if (ownerError) throw ownerError;
      family = { ...remoteFamily, local_only: false };
      await db.transaction('rw', db.families, db.family_members, async () => {
        await db.families.put(family);
        await db.family_members.put(ownerMember);
      });
    } else {
      family = {
        id: crypto.randomUUID(),
        name: normalizedName,
        created_at: now,
        updated_at: now,
        created_by: user?.id ?? null,
        local_only: true,
      };
      await db.families.put(family);
    }
    selectFamily(family.id);
    await refresh();
  }, [refresh, selectFamily, user]);

  const claimLocalFamily = useCallback(async (familyId: string) => {
    if (!user) throw new Error('Accedi prima di associare lo spazio locale al tuo account.');
    const family = await db.families.get(familyId);
    if (!family?.local_only || family.created_by !== null) {
      throw new Error('Questo spazio locale non è disponibile per l’associazione.');
    }
    const claimed = { ...family, created_by: user.id, updated_at: new Date().toISOString() };
    await db.families.put(claimed);
    selectFamily(familyId);
    await refresh();
  }, [refresh, selectFamily, user]);

  const createInvitation = useCallback(async (email: string) => {
    if (!activeFamilyId || !user || !supabase || !navigator.onLine) {
      throw new Error('Per invitare un membro servono una famiglia condivisa, l’accesso e una connessione.');
    }
    const { data, error: inviteError } = await supabase.rpc('create_family_invitation', {
      _id: crypto.randomUUID(),
      _family_id: activeFamilyId,
      _invited_email: email.trim().toLowerCase(),
    });
    if (inviteError) throw inviteError;
    const invitationData = data as {
      invitation_id?: string;
      token?: string;
      expires_at?: string;
      created_at?: string;
    }[] | {
      invitation_id?: string;
      token?: string;
      expires_at?: string;
      created_at?: string;
    } | null;
    const invitation = Array.isArray(invitationData) ? invitationData[0] : invitationData;
    if (!invitation?.invitation_id || !invitation.token || !invitation.expires_at || !invitation.created_at) {
      throw new Error('Il server non ha restituito un invito valido.');
    }
    await db.family_invitations.put({
      id: invitation.invitation_id,
      family_id: activeFamilyId,
      invited_email: email.trim().toLowerCase(),
      invited_by: user.id,
      expires_at: invitation.expires_at,
      accepted_at: null,
      created_at: invitation.created_at,
    });
    const link = `${window.location.origin}/#invite=${encodeURIComponent(invitation.token)}`;
    return { link, expiresAt: invitation.expires_at as string };
  }, [activeFamilyId, user]);

  const acceptInvitation = useCallback(async (token: string) => {
    if (!user || !supabase || !navigator.onLine) throw new Error('Accedi e connettiti a internet per accettare l’invito.');
    const { error: acceptError } = await supabase.rpc('accept_family_invitation', { _token: token.trim() });
    if (acceptError) throw acceptError;
    await refresh();
  }, [refresh, user]);

  const revokeMember = useCallback(async (userId: string) => {
    if (!activeFamilyId || !supabase) throw new Error('Famiglia condivisa non disponibile.');
    const { error: revokeError } = await supabase.rpc('revoke_family_member', {
      _family_id: activeFamilyId,
      _user_id: userId,
    });
    if (revokeError) throw revokeError;
    await refresh();
  }, [activeFamilyId, refresh]);

  const deleteFamily = useCallback(async (family: Family) => {
    if (!family.local_only) {
      if (!supabase) throw new Error('Supabase non è configurato.');
      const { error: deleteError } = await supabase.rpc('delete_family', { _family_id: family.id });
      if (deleteError) throw deleteError;
    }
    await removeLocalFamily(family.id);
    try { localStorage.removeItem(activeFamilyStorageKey(user?.id ?? null)); } catch { /* Nothing else is required. */ }
    await refresh();
  }, [refresh, user]);

  const activeFamily = families.find(family => family.id === activeFamilyId) ?? null;
  const activeRole = activeFamily?.local_only
    ? 'owner'
    : members.find(member => member.family_id === activeFamilyId && member.user_id === user?.id)?.role ?? null;
  const value = useMemo<FamilyContextValue>(() => ({
    families, members, activeFamily, activeRole, loading, error,
    selectFamily, refresh, createFamily, claimLocalFamily, createInvitation, acceptInvitation, revokeMember, deleteFamily, setError,
  }), [families, members, activeFamily, activeRole, loading, error, selectFamily, refresh, createFamily, claimLocalFamily, createInvitation, acceptInvitation, revokeMember, deleteFamily]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

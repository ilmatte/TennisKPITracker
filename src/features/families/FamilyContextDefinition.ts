import { createContext, useContext } from 'react';
import type { Family, FamilyMember } from '../../types';

export interface FamilyContextValue {
  families: Family[];
  members: FamilyMember[];
  activeFamily: Family | null;
  activeRole: FamilyMember['role'] | null;
  loading: boolean;
  error: string | null;
  selectFamily: (familyId: string) => void;
  refresh: () => Promise<void>;
  createFamily: (name: string, localOnly: boolean) => Promise<void>;
  claimLocalFamily: (familyId: string) => Promise<void>;
  createInvitation: (email: string) => Promise<{ link: string; expiresAt: string }>;
  acceptInvitation: (token: string) => Promise<void>;
  revokeMember: (userId: string) => Promise<void>;
  deleteFamily: (family: Family) => Promise<void>;
  setError: (message: string | null) => void;
}

export const FamilyContext = createContext<FamilyContextValue | null>(null);

export function useFamily() {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside FamilyProvider.');
  return value;
}

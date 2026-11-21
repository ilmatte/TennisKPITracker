import { createContext, useContext } from 'react';
import type { Family } from '../../types';

export interface FamilyContextValue {
  activeFamily: Family | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  acceptInvitation: (token: string) => Promise<string>;
  setError: (message: string | null) => void;
}

export const FamilyContext = createContext<FamilyContextValue | null>(null);

export function useFamily() {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside FamilyProvider.');
  return value;
}

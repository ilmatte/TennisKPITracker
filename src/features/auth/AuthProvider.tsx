import { useEffect, useState, type ReactNode } from 'react';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { supabase } from '../../services/supabase/client';
import { logTechnicalDiagnostic } from '../../services/uiMessages';

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthContextValue['user']>(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;

    let receivedAuthEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (receivedAuthEvent) return;
      if (error) logTechnicalDiagnostic('session-restoration', error);
      setUser(data.session?.user ?? null);
      setLoading(false);
    }).catch(error => {
      if (receivedAuthEvent) return;
      logTechnicalDiagnostic('session-restoration', error);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../services/supabase/client';
import './AuthStatus.css';

function getOAuthError() {
  const params = new URLSearchParams(window.location.search);
  return params.get('error_description') ?? params.get('error');
}

export default function AuthStatus() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(getOAuthError);

  useEffect(() => {
    if (!supabase) return;

    let receivedAuthEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      receivedAuthEvent = true;
      setUser(session?.user ?? null);
      setLoading(false);
      if (event !== 'INITIAL_SESSION') setError(null);
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (receivedAuthEvent) return;
      if (sessionError) {
        setError(sessionError.message);
      } else {
        setUser(data.session?.user ?? null);
      }
      setLoading(false);
    }).catch((sessionError: Error) => {
      if (receivedAuthEvent) return;
      setError(sessionError.message);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn() {
    if (!supabase) return;

    setPending(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (signInError) setError(signInError.message);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Accesso Google non riuscito.');
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    if (!supabase) return;

    setPending(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) setError(signOutError.message);
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Uscita non riuscita.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-control">
      {loading
        ? <span className="auth-message">Verifica sessione…</span>
        : user
          ? <>
              <span className="auth-email">{user.email ?? 'Utente autenticato'}</span>
              <button className="auth-button" onClick={signOut} disabled={pending}>
                {pending ? 'Uscita…' : 'Esci'}
              </button>
            </>
          : <button
              className="auth-button"
              onClick={signIn}
              disabled={pending || !supabase}
              title={!supabase ? 'Configura le variabili VITE_SUPABASE_* per abilitare l’accesso' : undefined}
            >
              {pending ? 'Accesso…' : 'Accedi con Google'}
            </button>}
      {error && <span className="auth-error" role="status">{error}</span>}
      {!supabase && !loading && <span className="auth-message">Accesso cloud non configurato</span>}
    </div>
  );
}

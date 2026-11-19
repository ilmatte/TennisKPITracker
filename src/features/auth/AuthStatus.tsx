import { useState } from 'react';
import { supabase } from '../../services/supabase/client';
import { useAuth } from './AuthContext';
import './AuthStatus.css';

export default function AuthStatus() {
  const { user, loading } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('error_description') ?? params.get('error');
  });

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

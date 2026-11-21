import { useState } from 'react';
import { supabase } from '../../services/supabase/client';
import { useAuth } from './AuthContext';
import './AuthStatus.css';
import { logTechnicalDiagnostic, normalizeUiError } from '../../services/uiMessages';

export default function AuthStatus() {
  const { user, loading } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('error_description') || params.has('error')
      ? normalizeUiError('auth')
      : null;
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
      if (signInError) {
        logTechnicalDiagnostic('oauth-sign-in', signInError);
        setError(normalizeUiError('auth', signInError));
      }
    } catch (signInError) {
      logTechnicalDiagnostic('oauth-sign-in', signInError);
      setError(normalizeUiError('auth', signInError));
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
      if (signOutError) {
        logTechnicalDiagnostic('oauth-sign-out', signOutError);
        setError(normalizeUiError('auth', signOutError));
      }
    } catch (signOutError) {
      logTechnicalDiagnostic('oauth-sign-out', signOutError);
      setError(normalizeUiError('auth', signOutError));
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
              title={!supabase ? 'Tennis Tracker Cloud non è disponibile al momento' : undefined}
            >
              {pending ? 'Accesso…' : 'Accedi con Google'}
            </button>}
      {error && <span className="auth-error" role="status">{error}</span>}
      {!supabase && !loading && <span className="auth-message">Tennis Tracker Cloud non è disponibile al momento</span>}
    </div>
  );
}

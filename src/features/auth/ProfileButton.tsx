import './ProfileButton.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase/client';
import { logTechnicalDiagnostic, normalizeUiError } from '../../services/uiMessages';
import { useAuth } from './AuthContext';

/** Profile button shown in the screen headers.
 *  - Logged out: generic profile icon, click starts the Google login.
 *  - Logged in: Google photo (or initials), email on the left, click opens a menu with "Esci".
 *  Positioning comes from `className` (the parent must be `position: relative`). */
export function ProfileButton({ className = '' }: { className?: string }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const metadata = (user?.user_metadata ?? {}) as { avatar_url?: string; picture?: string; full_name?: string; name?: string };
  const avatarUrl = metadata.avatar_url || metadata.picture;
  const displayName = metadata.full_name || metadata.name || '';
  const email = user?.email ?? '';
  const initials = (displayName
    ? displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('')
    : email.slice(0, 1)).toUpperCase();

  async function signIn() {
    if (!supabase || pending) return;
    setPending(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (signInError) throw signInError;
    } catch (cause) {
      logTechnicalDiagnostic('oauth-sign-in', cause);
      setError(normalizeUiError('auth', cause));
      setPending(false);
    }
  }

  async function signOut() {
    if (!supabase || pending) return;
    setPending(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setMenuOpen(false);
    } catch (cause) {
      logTechnicalDiagnostic('oauth-sign-out', cause);
      setError(normalizeUiError('auth', cause));
    } finally {
      setPending(false);
    }
  }

  return <div className={`profile-control ${className}`}>
    {user && <span className="profile-email" title={email}>{email}</span>}
    <button
      className={`profile-button${user ? ' signed-in' : ''}`}
      type="button"
      onClick={() => user ? setMenuOpen(open => !open) : void signIn()}
      disabled={loading || (!user && (pending || !supabase))}
      aria-label={user ? `Account: ${email}` : 'Accedi con Google'}
      title={user ? email : supabase ? 'Accedi con Google' : 'Tennis Tracker Cloud non è disponibile al momento'}
      aria-haspopup={user ? 'menu' : undefined}
      aria-expanded={user ? menuOpen : undefined}
    >
      {user
        ? avatarUrl && !imageFailed
          ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          : <span className="profile-initials">{initials || '✓'}</span>
        : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="9" r="3.6" /><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" /></svg>}
    </button>
    {user && menuOpen && <>
      <div className="profile-menu-backdrop" onClick={() => setMenuOpen(false)} />
      <div className="profile-menu" role="menu">
        <div className="profile-menu-head">
          {displayName && <strong>{displayName}</strong>}
          <span>{email}</span>
        </div>
        <button role="menuitem" onClick={() => { setMenuOpen(false); navigate('/settings'); }}>Impostazioni</button>
        <button role="menuitem" className="danger" onClick={() => void signOut()} disabled={pending}>{pending ? 'Uscita…' : 'Esci'}</button>
        {error && <p className="profile-error" role="alert">{error}</p>}
      </div>
    </>}
    {!user && error && <p className="profile-error floating" role="alert">{error}</p>}
  </div>;
}

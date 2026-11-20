import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useFamily } from './FamilyContextDefinition';
import './FamilyManager.css';

function readInviteToken() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get('invite');
  if (token) {
    try { sessionStorage.setItem('tennis-kpi-pending-invite', token); } catch { /* The token remains in the URL. */ }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  try { return token ?? sessionStorage.getItem('tennis-kpi-pending-invite') ?? ''; } catch { return token ?? ''; }
}

export default function FamilyManager() {
  const { user } = useAuth();
  const { acceptInvitation, error, setError } = useFamily();
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitAcceptance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await acceptInvitation(inviteToken);
      setInviteToken('');
      try { sessionStorage.removeItem('tennis-kpi-pending-invite'); } catch { /* Nothing else is required. */ }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setMessage('Invito accettato: ora fai parte della famiglia.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile accettare l’invito.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-section family-manager">
      <h2>Invito alla condivisione</h2>
      {error && <p className="family-feedback error" role="alert">{error}</p>}
      {message && <p className="family-feedback" role="status">{message}</p>}
      {inviteToken ? <form className="family-invite-form" onSubmit={submitAcceptance}>
        {!user && <p>Accedi con l’account Google invitato, poi conferma l’accettazione.</p>}
        <label>Token invito<input value={inviteToken} onChange={event => setInviteToken(event.target.value)} required /></label>
        <button className="primary wide" disabled={pending || !user || !navigator.onLine}>Accetta invito</button>
      </form> : <p className="cloud-state">Non è presente un invito da accettare.</p>}
    </section>
  );
}

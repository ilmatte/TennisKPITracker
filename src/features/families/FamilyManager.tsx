import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../../sync/SyncContextDefinition';
import './FamilyManager.css';
import { logTechnicalDiagnostic, normalizeUiError } from '../../services/uiMessages';

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
  const { acceptInvitationAndSync, error } = useSync();
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitAcceptance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const syncStatus = await acceptInvitationAndSync(inviteToken);
      setInviteToken('');
      try { sessionStorage.removeItem('tennis-kpi-pending-invite'); } catch { /* Nothing else is required. */ }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setMessage(syncStatus === 'needs-attention'
        ? 'Invito accettato. Sono presenti dati locali indipendenti: la sincronizzazione è sospesa in attesa di una scelta esplicita.'
        : syncStatus === 'synced'
          ? 'Invito accettato: i dati della famiglia sono disponibili su questo dispositivo.'
          : 'Invito accettato. Il download iniziale è in attesa di connessione o di un nuovo tentativo.');
    } catch (cause) {
      logTechnicalDiagnostic('invitation', cause);
      setMessage(normalizeUiError('invitation', cause));
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

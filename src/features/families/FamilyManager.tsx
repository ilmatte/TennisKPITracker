import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../../services/supabase/client';
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

export default function FamilyManager({ invitationOnly = false }: { invitationOnly?: boolean }) {
  const { user } = useAuth();
  const {
    families, members, activeFamily, activeRole, loading, error,
    selectFamily, refresh, createFamily, claimLocalFamily, createInvitation, acceptInvitation, revokeMember, deleteFamily, setError,
  } = useFamily();
  const unclaimedLocalFamilies = useLiveQuery(
    async () => (await db.families.toArray()).filter(family => family.local_only && family.created_by === null),
    [],
  ) ?? [];
  const [familyName, setFamilyName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteExpires, setInviteExpires] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const familyMembers = useMemo(
    () => members.filter(member => member.family_id === activeFamily?.id),
    [members, activeFamily?.id],
  );

  async function run(action: () => Promise<void>, success?: string) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operazione non riuscita.');
    } finally {
      setPending(false);
    }
  }

  async function submitFamily(localOnly: boolean) {
    await run(async () => {
      await createFamily(familyName, localOnly);
      setFamilyName('');
    }, localOnly ? 'Spazio locale creato.' : 'Famiglia condivisa creata.');
  }

  async function submitInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const invitation = await createInvitation(inviteEmail);
      setInviteLink(invitation.link);
      setInviteExpires(invitation.expiresAt);
      setInvitedEmail(inviteEmail.trim());
      setInviteEmail('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile creare l’invito.');
    } finally {
      setPending(false);
    }
  }

  async function submitAcceptance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await acceptInvitation(inviteToken);
      setInviteToken('');
      try { sessionStorage.removeItem('tennis-kpi-pending-invite'); } catch { /* Nothing else is required. */ }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }, 'Invito accettato: ora fai parte della famiglia.');
  }

  async function copyInvitation() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setMessage('Link copiato. Invialo via email alla persona invitata.');
    } catch {
      setError('Copia automatica non disponibile. Seleziona e copia il link dall’email.');
    }
  }

  async function removeFamily() {
    if (!activeFamily || !window.confirm(`Eliminare definitivamente la famiglia "${activeFamily.name}" e i dati locali associati?`)) return;
    await run(() => deleteFamily(activeFamily), 'Famiglia eliminata.');
  }

  if (invitationOnly) {
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

  return (
    <section className="settings-section family-manager">
      <h2>Famiglia e spazio dati</h2>
      {error && <p className="family-feedback error" role="alert">{error}</p>}
      {message && <p className="family-feedback" role="status">{message}</p>}

      {loading
        ? <p className="cloud-state">Caricamento famiglie…</p>
        : families.length > 0
          ? <label className="family-select">
              <span>Spazio attivo</span>
              <select value={activeFamily?.id ?? ''} onChange={event => selectFamily(event.target.value)}>
                {families.map(family => <option key={family.id} value={family.id}>{family.name}{family.local_only ? ' · solo su questo dispositivo' : ''}</option>)}
              </select>
            </label>
          : <p className="cloud-state">Nessuno spazio disponibile. Crea uno spazio locale o una famiglia condivisa.</p>}

      {activeFamily && <>
        <div className="family-summary">
          <strong>{activeFamily.name}</strong>
          <span>{activeFamily.local_only ? 'Dati solo su questo dispositivo' : `Ruolo: ${activeRole === 'owner' ? 'creatore' : 'membro'}`}</span>
        </div>
        {!activeFamily.local_only && <>
          <h3>Membri</h3>
          <div className="family-member-list">
            {familyMembers.map(member => (
              <div className="family-member" key={`${member.family_id}:${member.user_id}`}>
                <span>{member.member_email || member.user_id}</span>
                <strong>{member.role === 'owner' ? 'Creatore' : 'Membro'}</strong>
                {activeRole === 'owner' && member.role !== 'owner' && (
                  <button className="danger" disabled={pending} onClick={() => run(
                    () => revokeMember(member.user_id),
                    'Accesso del membro revocato.',
                  )}>Revoca</button>
                )}
              </div>
            ))}
            {!familyMembers.length && <span className="auth-message">Nessun membro disponibile offline.</span>}
          </div>
          <form className="family-invite-form" onSubmit={submitInvitation}>
            <label>Email Google del genitore<input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} /></label>
            <button className="secondary wide" disabled={pending || !user || !navigator.onLine}>Crea invito</button>
          </form>
          {inviteLink && <div className="invitation-result">
            <p>Invito valido fino a {new Date(inviteExpires ?? '').toLocaleString('it-IT')}. Invia il link solo all’indirizzo invitato.</p>
            <textarea readOnly value={inviteLink} rows={3} aria-label="Link di invito" />
            <button className="secondary" onClick={copyInvitation}>Copia link</button>
            <a href={`mailto:${encodeURIComponent(invitedEmail)}?subject=${encodeURIComponent(`Invito a ${activeFamily.name}`)}&body=${encodeURIComponent(`Accetta l'invito con il tuo account Google (${invitedEmail}): ${inviteLink}`)}`}>Apri email</a>
          </div>}
        </>}
        {activeRole === 'owner' && <button className="danger family-delete" onClick={removeFamily}>Elimina famiglia</button>}
      </>}

      {user && unclaimedLocalFamilies.map(family => <div className="family-summary" key={family.id}>
        <span>Dati locali non ancora associati: {family.name}</span>
        <button className="secondary" disabled={pending} onClick={() => void run(
          () => claimLocalFamily(family.id),
          'Spazio locale associato a questo account.',
        )}>Usa con questo account</button>
      </div>)}

      <form className="family-create-form" onSubmit={event => { event.preventDefault(); void submitFamily(false); }}>
        <label>Nome famiglia<input value={familyName} onChange={event => setFamilyName(event.target.value)} maxLength={100} required /></label>
        <button className="primary wide" disabled={pending || !familyName.trim() || !user || !supabase || !navigator.onLine}>
          Crea famiglia condivisa
        </button>
        <button type="button" className="secondary wide" disabled={pending || !familyName.trim()} onClick={() => void submitFamily(true)}>
          Crea spazio solo locale
        </button>
      </form>

      {inviteToken && <form className="family-invite-form" onSubmit={submitAcceptance}>
        <h3>Accetta un invito</h3>
        {!user && <p>Accedi con l’account Google invitato, poi conferma l’accettazione.</p>}
        <label>Token invito<input value={inviteToken} onChange={event => setInviteToken(event.target.value)} required /></label>
        <button className="primary wide" disabled={pending || !user || !navigator.onLine}>Accetta invito</button>
      </form>}
      <button className="family-refresh" disabled={loading} onClick={() => void refresh()}>Aggiorna famiglie e membri</button>
    </section>
  );
}

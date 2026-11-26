import './Players.css';
import './Clubs.css';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { createClub, softDeleteClub, updateClub, type ClubChanges } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import { CLUB_SURFACES, surfaceLabel } from '../features/clubs/surfaces';
import settingsBackground from '../assets/background-settings.png';
import tennisLogo from '../assets/logo.svg';
import { BrandBar } from './BrandBar';
import type { Club } from '../types';

const courtIcon = (size: number, color: string) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14M3 12h18M7.5 8.5v7M16.5 8.5v7" />
</svg>;

/** Club list (from Impostazioni). The list layout reuses the Giocatori screen styles (Players.css). */
export function Clubs() {
  const { activeFamily } = useFamily();
  const navigate = useNavigate();
  const clubs = useLiveQuery(
    async () => activeFamily
      ? (await db.clubs.where('family_id').equals(activeFamily.id).toArray())
          .filter(club => !club.deleted)
          .sort((a, b) => a.name.localeCompare(b.name, 'it'))
      : [],
    [activeFamily?.id],
  ) ?? [];
  // null: editor closed; 'new': new club; a club: editing it.
  const [editing, setEditing] = useState<Club | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function open(club: Club | 'new') {
    setError(null);
    setEditing(club);
  }

  async function save(changes: ClubChanges) {
    if (!activeFamily || !editing) return;
    try {
      if (editing === 'new') await createClub(activeFamily.id, changes);
      else await updateClub(activeFamily.id, editing.id, changes);
      setEditing(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare il club.');
    }
  }

  async function remove(club: Club) {
    if (!activeFamily) return;
    if (!window.confirm(`Eliminare il club “${club.name}”?`)) return;
    try {
      await softDeleteClub(activeFamily.id, club.id);
      setEditing(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile eliminare il club.');
    }
  }

  return <div className="pl-page" style={{ '--pl-bg': `url(${settingsBackground})` } as CSSProperties}>
    <div className="pl-top" aria-hidden="true" />
    <BrandBar shadow />
    <button className="pl-back" onClick={() => navigate('/settings')} aria-label="Indietro">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h1 className="pl-title">Club</h1>
    <section className="pl-card">
      {clubs.map(club => {
        const details = [club.city, surfaceLabel(club.surface)].filter(Boolean).join(' • ');
        return <button className="pl-row" key={club.id} onClick={() => open(club)}>
          <span className="pl-avatar">{courtIcon(24, '#C8F03A')}</span>
          <span className="pl-text"><strong>{club.name}</strong><small>{details || 'Nessuna città indicata'}</small></span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>;
      })}
      {!clubs.length && <div className="pl-empty"><strong>Nessun club</strong><span>Aggiungi i circoli dove giochi.</span></div>}
    </section>
    <button className="pl-add" onClick={() => open('new')} disabled={!activeFamily}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      Aggiungi club
    </button>
    {editing && <ClubEditor club={editing === 'new' ? null : editing} error={error}
      onClose={() => setEditing(null)} onSave={changes => void save(changes)}
      onDelete={editing === 'new' ? undefined : () => void remove(editing)} />}
  </div>;
}

/** "Nuovo club" / "Modifica club" full-screen form. */
function ClubEditor({ club, error, onClose, onSave, onDelete }: {
  club: Club | null;
  error: string | null;
  onClose: () => void;
  onSave: (changes: ClubChanges) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<ClubChanges>({ name: club?.name ?? '', city: club?.city ?? '', surface: club?.surface ?? null });
  const title = club ? 'Modifica club' : 'Nuovo club';

  return <div className="club-editor-backdrop">
    <section className="club-editor" role="dialog" aria-modal="true" aria-label={title}
      style={{ '--club-bg': `url(${settingsBackground})` } as CSSProperties}>
      <header className="club-editor-header">
        <div className="brand-bar-logo shadow"><img src={tennisLogo} alt="" /><div>Tennis<br />KPI Tracker</div></div>
        <button className="club-editor-back" onClick={onClose} aria-label="Indietro">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <h1>{title}</h1>
      </header>
      <div className="club-editor-panel">
        <div className="club-editor-fields">
          <label className="club-editor-field">Nome del club
            <input value={draft.name} placeholder="Es. TC Lambrate" autoComplete="organization" onChange={event => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="club-editor-field">Città
            <input value={draft.city} placeholder="Es. Milano" autoComplete="address-level2" onChange={event => setDraft({ ...draft, city: event.target.value })} />
          </label>
          <div className="club-editor-field" role="group" aria-label="Superficie dei campi">
            <span>Superficie dei campi <em>(facoltativo)</em></span>
            <div className="club-editor-surfaces">
              {CLUB_SURFACES.map(surface => <button key={surface.code} type="button"
                className={draft.surface === surface.code ? 'selected' : ''} aria-pressed={draft.surface === surface.code}
                // Tapping the selected surface again clears it (the field is optional).
                onClick={() => setDraft({ ...draft, surface: draft.surface === surface.code ? null : surface.code })}>
                {surface.label}
              </button>)}
            </div>
          </div>
        </div>
        {error && <p className="family-feedback error" role="alert">{error}</p>}
        <div className="club-editor-actions">
          <button className="club-editor-save" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Salva club
          </button>
          {onDelete && <button className="club-editor-delete" onClick={onDelete}>Elimina club</button>}
        </div>
      </div>
    </section>
  </div>;
}

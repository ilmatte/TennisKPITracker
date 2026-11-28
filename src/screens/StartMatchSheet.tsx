import './ScheduledMatch.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { initial } from '../features/matches/scheduledMatch';
import type { Match } from '../types';

type Server = NonNullable<Match['first_server']>;

/** Bottom sheet "Chi serve per primo?", the last choice before a match starts: one large tile per player, and "Inizia
 *  partita" enabled only once a server is chosen. Modal dialog: Escape and the backdrop close it, focus moves into it.
 *  Used by the wizard ("Avvia subito"), the Partite list ("Avvia") and the upcoming match detail ("Avvia partita").
 *  Rendered in document.body: inside a screen that creates its own stacking context (the Partite page is
 *  `isolation: isolate`) the bottom navigation bar would cover the sheet and its "Inizia partita" button. */
export function StartMatchSheet({ playerName, opponent, initialServer, busy = false, error, onCancel, onConfirm }: {
  playerName: string;
  opponent: string;
  /** Server already chosen in the wizard: preselected. */
  initialServer: Match['first_server'];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (server: Server) => void;
}) {
  const [server, setServer] = useState<Match['first_server']>(initialServer);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    closeRef.current?.focus();
    return () => { (previousFocus.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const options: [Server, string][] = [['player', playerName.trim() || 'Giocatore'], ['opponent', opponent.trim() || 'Avversario']];

  return createPortal(<div className="sm-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !busy) onCancel(); }}>
    <div className="sm-sheet" role="dialog" aria-modal="true" aria-labelledby="sm-title" aria-describedby="sm-description">
      <div className="sm-grabber" aria-hidden="true" />
      <div className="sm-heading">
        <div>
          <h2 id="sm-title">Chi serve per primo?</h2>
          <p id="sm-description">Ultimo dato prima di iniziare. Il resto è già pronto.</p>
        </div>
        <button ref={closeRef} type="button" className="sm-close" aria-label="Chiudi" onClick={onCancel} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="sm-options" role="group" aria-label="Chi serve per primo">
        {options.map(([side, name]) => {
          const pressed = server === side;
          return <button key={side} type="button" className={`sm-option${pressed ? ' selected' : ''}`} aria-pressed={pressed}
            onClick={() => setServer(side)}>
            <span className="sm-avatar" aria-hidden="true">{initial(name)}</span>
            <span className="sm-name">{name}</span>
            <span className="sm-serving" aria-hidden={!pressed}>
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#C8F03A" stroke="#1B5E20" strokeWidth="3" /><path d="M10 6c12 10 12 26 0 36M38 6c-12 10-12 26 0 36" fill="none" stroke="#1B5E20" strokeWidth="3" /></svg>
              Al servizio
            </span>
          </button>;
        })}
      </div>
      {error && <p className="cw-error" role="alert">{error}</p>}
      {server
        ? <button type="button" className="sm-start" disabled={busy} onClick={() => onConfirm(server)}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="#0B2A5B" stroke="#0B2A5B" strokeWidth="2" strokeLinejoin="round" /></svg>
          Inizia partita
        </button>
        : <button type="button" className="sm-start" disabled>Scegli chi serve per iniziare</button>}
    </div>
  </div>, document.body);
}

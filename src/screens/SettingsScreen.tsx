import './Settings.css';
import { useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { migrateLegacyPointPayload } from '../db/pointWinner';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import FamilyManager from '../features/families/FamilyManager';
import { useSync } from '../sync/SyncContextDefinition';
import { stamp, queueOperation } from './shared';
import { BrandBar } from './BrandBar';
import settingsBackground from '../assets/background-settings.png';
import type { Club, Game, Match, Player, Point, TennisSet } from '../types';
export function Settings() {
  const { activeFamily } = useFamily();
  const { user } = useAuth();
  const { mapping, status, busy, error: syncError, conflicts, activate, syncNow, resolveConflict } = useSync();
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [openPanel, setOpenPanel] = useState<'sharing' | 'info' | null>(null);
  const owner = useLiveQuery(async () => activeFamily
    ? (await db.family_members.where('family_id').equals(activeFamily.id).toArray()).find(member => member.role === 'owner') ?? null
    : null, [activeFamily?.id]);
  let pendingInvite = false;
  try { pendingInvite = Boolean(sessionStorage.getItem('tennis-kpi-pending-invite')); } catch { /* Continue without a cached invitation. */ }
  const invitationFlow = new URLSearchParams(location.hash.slice(1)).has('invite') || pendingInvite;

  async function jsonExport() {
    if (!activeFamily) return;
    const [players, clubs, matches, sets, games] = await Promise.all([
      db.players.where('family_id').equals(activeFamily.id).toArray(),
      db.clubs.where('family_id').equals(activeFamily.id).toArray(),
      db.matches.where('family_id').equals(activeFamily.id).toArray(),
      db.sets.where('family_id').equals(activeFamily.id).toArray(),
      db.games.where('family_id').equals(activeFamily.id).toArray(),
    ]);
    const gameIds = new Set(games.map(game => game.id));
    const points = gameIds.size ? await db.points.where('game_id').anyOf([...gameIds]).toArray() : [];
    const backup = { version: 3, exported_at: stamp(), family_id: activeFamily.id, players, clubs, matches, sets, games, points };
    download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `tennis-kpi-backup-${new Date().toISOString().slice(0, 10)}.json`);
    setMessage('Backup JSON esportato');
  }

  async function restore(event: React.ChangeEvent<HTMLInputElement>) {
    if (!activeFamily) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!backup || typeof backup !== 'object' || !('version' in backup) || (backup.version !== 2 && backup.version !== 3) ||
        !('family_id' in backup) || backup.family_id !== activeFamily.id) {
        throw new Error('Il backup deve essere versione 2 o 3 e appartenere allo spazio attivo.');
      }
      const data = backup as {
        players?: Player[]; clubs?: Club[]; matches?: Match[]; sets?: TennisSet[]; games?: Game[]; points?: Point[];
      };
      const players = data.players ?? [];
      const clubs = data.clubs ?? []; // absent in backups written before clubs existed
      const matches = data.matches ?? [];
      const sets = data.sets ?? [];
      const games = data.games ?? [];
      // Version 2 backups use the legacy point fields (winner, server, double_fault, ...): convert them.
      const points = (data.points ?? []).map(point => migrateLegacyPointPayload(point));
      const sameFamily = [...players, ...clubs, ...matches, ...sets, ...games, ...points].every(record => record.family_id === activeFamily.id);
      const playerIds = new Set(players.map(player => player.id));
      const matchIds = new Set(matches.map(match => match.id));
      const setIds = new Set(sets.map(set => set.id));
      const gameIds = new Set(games.map(game => game.id));
      if (!sameFamily || matches.some(match => !playerIds.has(match.player_id)) ||
        sets.some(set => !matchIds.has(set.match_id)) || games.some(game => !setIds.has(game.set_id)) ||
        points.some(point => !gameIds.has(point.game_id))) {
        throw new Error('Il backup contiene dati con famiglia o relazioni non valide.');
      }
      const updated_at = stamp();
      await db.transaction('rw', [
        db.players, db.clubs, db.matches, db.sets, db.games, db.points, db.syncQueue,
      ], async () => {
        const [storedPlayers, storedClubs, storedMatches, storedSets, storedGames, storedPoints] = await Promise.all([
          db.players.bulkGet(players.map(player => player.id)),
          db.clubs.bulkGet(clubs.map(club => club.id)),
          db.matches.bulkGet(matches.map(match => match.id)),
          db.sets.bulkGet(sets.map(set => set.id)),
          db.games.bulkGet(games.map(game => game.id)),
          db.points.bulkGet(points.map(point => point.id)),
        ]);
        const refreshVersions = <T extends { id: string; updated_at: string; version: number }>(
          records: T[],
          existing: (T | undefined)[],
        ): T[] => records.map((record, index) => {
          const previous = existing[index];
          return {
            ...record,
            updated_at,
            version: previous
              ? Math.max(previous.version, record.version) + 1
              : Math.max(1, record.version),
          };
        });
        const updatedPlayers = refreshVersions(players, storedPlayers);
        const updatedClubs = refreshVersions(clubs, storedClubs);
        const updatedMatches = refreshVersions(matches, storedMatches);
        const updatedSets = refreshVersions(sets, storedSets);
        const updatedGames = refreshVersions(games, storedGames);
        const updatedPoints = refreshVersions(points, storedPoints);
        await db.players.bulkPut(updatedPlayers);
        await db.clubs.bulkPut(updatedClubs);
        await db.matches.bulkPut(updatedMatches);
        await db.sets.bulkPut(updatedSets);
        await db.games.bulkPut(updatedGames);
        await db.points.bulkPut(updatedPoints);
        await db.syncQueue.bulkPut([
          ...updatedPlayers.map(record => queueOperation(activeFamily.id, 'players', record, updated_at)),
          ...updatedClubs.map(record => queueOperation(activeFamily.id, 'clubs', record, updated_at)),
          ...updatedMatches.map(record => queueOperation(activeFamily.id, 'matches', record, updated_at)),
          ...updatedSets.map(record => queueOperation(activeFamily.id, 'sets', record, updated_at)),
          ...updatedGames.map(record => queueOperation(activeFamily.id, 'games', record, updated_at)),
          ...updatedPoints.map(record => queueOperation(activeFamily.id, 'points', record, updated_at)),
        ]);
      });
      setMessage('Backup ripristinato nello spazio attivo.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'File backup non valido');
    } finally {
      event.target.value = '';
    }
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const syncOn = Boolean(mapping?.enabled);
  const syncSubtitle = {
    'local-only': 'Non attiva · solo su questo dispositivo',
    'signed-in-disabled': 'Non attiva',
    syncing: 'Sincronizzazione in corso…',
    synced: 'Attiva',
    'offline-pending': 'Attiva · modifiche in attesa di connessione',
    'retryable-error': 'Errore temporaneo · riprova',
    'needs-attention': 'Serve una tua scelta',
    'permanent-error': 'Sospesa · intervento necessario',
  }[status];
  const userName = (user?.user_metadata as { full_name?: string } | undefined)?.full_name || user?.email;
  const ownerLabel = activeFamily?.local_only || !owner
    ? 'solo su questo dispositivo'
    : owner.user_id === user?.id ? (userName ?? 'tu') : owner.member_email;
  const togglePanel = (panel: 'sharing' | 'info') => setOpenPanel(current => current === panel ? null : panel);
  const chevron = <svg className="stg-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>;

  return <div className="stg-page" style={{ '--stg-bg': `url(${settingsBackground})` } as CSSProperties}>
    <BrandBar shadow />
    <h1 className="stg-title">Impostazioni</h1>
    <section className="stg-card">
      <button className="stg-row" onClick={() => navigate('/players')}>
        <span className="stg-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.6-3.8 3.2-5.8 6.5-5.8s5.9 2 6.5 5.8" /><path d="M3.5 11.5c-.6.9-.8 1.9-.5 3" /><path d="M20.5 11.5c.6.9.8 1.9.5 3" /></svg></span>
        <span className="stg-text"><strong>Giocatori</strong><small>Gestisci i tuoi giocatori</small></span>
        {chevron}
      </button>
      <button className="stg-row" onClick={() => navigate('/clubs')}>
        <span className="stg-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14M3 12h18M7.5 8.5v7M16.5 8.5v7" /></svg></span>
        <span className="stg-text"><strong>Club</strong><small>Circoli e campi dove giochi</small></span>
        {chevron}
      </button>
      <div className="stg-row">
        <span className="stg-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.3L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15" /><path d="M20 20v-5h-5" /></svg></span>
        <span className="stg-text"><strong>Sincronizzazione</strong><small>{busy ? 'Sincronizzazione in corso…' : user ? syncSubtitle : 'Accedi con Google per attivarla'}</small></span>
        <button className={`stg-toggle${syncOn ? ' on' : ''}`} role="switch" aria-checked={syncOn} aria-label="Sincronizzazione"
          onClick={() => void activate()} disabled={syncOn || busy || !user || status === 'needs-attention'}><span /></button>
      </div>
      <button className="stg-row" onClick={() => togglePanel('sharing')} aria-expanded={openPanel === 'sharing'}>
        <span className="stg-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="6" r="2.6" /><circle cx="18" cy="18" r="2.6" /><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6" /></svg></span>
        <span className="stg-text"><strong>Condivisioni</strong><small>Workspace owner: {ownerLabel}</small></span>
        {chevron}
      </button>
      <button className="stg-row" onClick={() => togglePanel('info')} aria-expanded={openPanel === 'info'}>
        <span className="stg-icon"><svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#0B2A5B" /><circle cx="12" cy="7.6" r="1.4" fill="#fff" /><path d="M12 11v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg></span>
        <span className="stg-text"><strong>Informazioni</strong><small>Versione {__APP_VERSION__}</small></span>
        {chevron}
      </button>
      <div className="stg-row">
        <span className="stg-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z" /><path d="M12 17v-6M9.5 13.5L12 11l2.5 2.5" /></svg></span>
        <span className="stg-text"><strong>Backup</strong><small>Salva i dati in un file JSON</small></span>
        <button className="stg-export" onClick={() => void jsonExport()} disabled={!activeFamily}>Esporta</button>
      </div>
    </section>

    {openPanel === 'info' && <section className="stg-card stg-panel">
      <h2>Tennis KPI Tracker</h2>
      <p>Versione {__APP_VERSION__}</p>
      <p>{syncOn ? 'I dati sono salvati su questo dispositivo e sincronizzati con Tennis Tracker Cloud.' : 'I dati sono salvati solo su questo dispositivo.'}</p>
    </section>}
    {openPanel === 'sharing' && <section className="stg-card stg-panel">
      <h2>Condivisioni</h2>
      <p>Workspace owner: {ownerLabel}</p>
      {mapping?.remote_family_id && <p>Il tuo ruolo: {mapping.role === 'owner' ? 'proprietario' : 'membro'}</p>}
    </section>}
    {(openPanel === 'sharing' || invitationFlow) && <div className="stg-card stg-panel"><FamilyManager /></div>}

    {(syncError || conflicts.length > 0 || syncOn) && <section className="stg-card stg-panel">
      <h2>Sincronizzazione</h2>
      {mapping?.remote_family_id && <p>Ultimo download: {mapping.last_download_completed_at ? new Date(mapping.last_download_completed_at).toLocaleString('it-IT') : 'non completato'}</p>}
      {syncOn && <button className="stg-row" onClick={() => void syncNow()} disabled={busy}>
        <span className="stg-text"><strong>{busy ? 'Sincronizzazione…' : status === 'permanent-error' ? 'Riprova sincronizzazione' : 'Sincronizza ora'}</strong></span>
        {chevron}
      </button>}
      {syncError && <p className="family-feedback error" role="alert">{syncError}</p>}
      {conflicts.length > 0 && <div className="sync-conflicts">
        <p>{conflicts.length} conflitto/i: scegli quale versione mantenere per ogni record.</p>
        {conflicts.map(conflict => <div className="sync-conflict" key={conflict.id}>
          <strong>{conflict.entity_type} · {conflict.entity_id}</strong>
          <small>{conflict.reason === 'constraint'
            ? 'Il dato viola un vincolo univoco remoto. Modifica il dato locale prima di riprovare.'
            : 'Il record è stato modificato anche su un altro dispositivo.'}</small>
          <button className="secondary" onClick={() => void resolveConflict(conflict.id, 'local')}>
            {conflict.reason === 'constraint' ? 'Riprova il dato locale corretto' : 'Mantieni questo dispositivo'}
          </button>
          {conflict.reason === 'version' && conflict.remote_payload !== null &&
            <button className="secondary" onClick={() => void resolveConflict(conflict.id, 'remote')}>Usa la versione di Tennis Tracker Cloud</button>}
        </div>)}
      </div>}
    </section>}

    {/* Restore is hidden from the UI for now; the logic stays available. */}
    <label hidden><input type="file" accept="application/json" onChange={event => void restore(event)} /></label>
    {message && <div className="toast" role="status">{message}</div>}
  </div>;
}

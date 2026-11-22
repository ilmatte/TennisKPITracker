import './Settings.css';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { db, getMatchPoints } from '../db/database';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import FamilyManager from '../features/families/FamilyManager';
import { useSync } from '../sync/SyncContextDefinition';
import { stamp, queueOperation } from './shared';
import type { Game, Match, Player, Point, TennisSet } from '../types';
export function Settings() {
  const { activeFamily } = useFamily();
  const { user } = useAuth();
  const { mapping, status, busy, error: syncError, conflicts, activate, syncNow, resolveConflict } = useSync();
  const location = useLocation();
  const [message, setMessage] = useState('');
  let pendingInvite = false;
  try { pendingInvite = Boolean(sessionStorage.getItem('tennis-kpi-pending-invite')); } catch { /* Continue without a cached invitation. */ }
  const invitationFlow = new URLSearchParams(location.hash.slice(1)).has('invite') || pendingInvite;

  async function jsonExport() {
    if (!activeFamily) return;
    const [players, matches, sets, games] = await Promise.all([
      db.players.where('family_id').equals(activeFamily.id).toArray(),
      db.matches.where('family_id').equals(activeFamily.id).toArray(),
      db.sets.where('family_id').equals(activeFamily.id).toArray(),
      db.games.where('family_id').equals(activeFamily.id).toArray(),
    ]);
    const gameIds = new Set(games.map(game => game.id));
    const points = gameIds.size ? await db.points.where('game_id').anyOf([...gameIds]).toArray() : [];
    const backup = { version: 2, exported_at: stamp(), family_id: activeFamily.id, players, matches, sets, games, points };
    download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `tennis-kpi-backup-${new Date().toISOString().slice(0, 10)}.json`);
    setMessage('Backup JSON esportato');
  }

  async function csvExport() {
    if (!activeFamily) return;
    const matches = (await db.matches.where('family_id').equals(activeFamily.id).toArray()).filter(match => !match.deleted);
    const sets = await db.sets.where('family_id').equals(activeFamily.id).toArray();
    const games = await db.games.where('family_id').equals(activeFamily.id).toArray();
    const setById = new Map(sets.map(set => [set.id, set]));
    const matchById = new Map(matches.map(match => [match.id, match]));
    const gameToMatch = new Map(games.flatMap(game => {
      const set = setById.get(game.set_id);
      return set && matchById.has(set.match_id) ? [[game.id, set.match_id] as const] : [];
    }));
    const allPoints = (await Promise.all(matches.map(match => getMatchPoints(activeFamily.id, match.id)))).flat().filter(point => !point.deleted);
    const csv = [
      'id,match_id,set,game,point,winner,server,shot_count,free_error',
      ...allPoints.map(point => [point.id, gameToMatch.get(point.game_id) ?? '', point.set_number, point.game_number, point.point_number, point.winner, point.server, point.shot_count, point.free_error].join(',')),
    ].join('\n');
    download(new Blob([csv], { type: 'text/csv' }), 'tennis-kpi.csv');
    setMessage('CSV esportato');
  }

  async function pdfExport() {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Tennis KPI Report', 14, 20);
    doc.setFontSize(11);
    doc.text(`Generato il ${new Date().toLocaleString('it-IT')}`, 14, 30);
    doc.save('tennis-kpi-report.pdf');
    setMessage('PDF esportato');
  }

  async function restore(event: React.ChangeEvent<HTMLInputElement>) {
    if (!activeFamily) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!backup || typeof backup !== 'object' || !('version' in backup) || backup.version !== 2 ||
        !('family_id' in backup) || backup.family_id !== activeFamily.id) {
        throw new Error('Il backup deve essere versione 2 e appartenere allo spazio attivo.');
      }
      const data = backup as {
        players?: Player[]; matches?: Match[]; sets?: TennisSet[]; games?: Game[]; points?: Point[];
      };
      const players = data.players ?? [];
      const matches = data.matches ?? [];
      const sets = data.sets ?? [];
      const games = data.games ?? [];
      const points = data.points ?? [];
      const sameFamily = [...players, ...matches, ...sets, ...games, ...points].every(record => record.family_id === activeFamily.id);
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
        db.players, db.matches, db.sets, db.games, db.points, db.syncQueue,
      ], async () => {
        const [storedPlayers, storedMatches, storedSets, storedGames, storedPoints] = await Promise.all([
          db.players.bulkGet(players.map(player => player.id)),
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
        const updatedMatches = refreshVersions(matches, storedMatches);
        const updatedSets = refreshVersions(sets, storedSets);
        const updatedGames = refreshVersions(games, storedGames);
        const updatedPoints = refreshVersions(points, storedPoints);
        await db.players.bulkPut(updatedPlayers);
        await db.matches.bulkPut(updatedMatches);
        await db.sets.bulkPut(updatedSets);
        await db.games.bulkPut(updatedGames);
        await db.points.bulkPut(updatedPoints);
        await db.syncQueue.bulkPut([
          ...updatedPlayers.map(record => queueOperation(activeFamily.id, 'players', record, updated_at)),
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

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Dati e account</p><h1>Impostazioni</h1></div></div>
    {invitationFlow && <FamilyManager />}
    <section className="settings-section"><h2>Backup</h2>
      <button className="setting-row" onClick={() => void jsonExport()} disabled={!activeFamily}><span>Esporta JSON dello spazio</span><b>›</b></button>
      <button className="setting-row" onClick={() => void csvExport()} disabled={!activeFamily}><span>Esporta KPI CSV</span><b>›</b></button>
      <button className="setting-row" onClick={() => void pdfExport()}><span>Esporta report PDF</span><b>›</b></button>
      <label className="setting-row"><span>Ripristina backup JSON v2</span><b>›</b><input type="file" accept="application/json" onChange={event => void restore(event)} /></label>
    </section>
    <section className="settings-section"><h2>Sincronizzazione</h2>
      <div className="cloud-state">
        <span>{{
          'local-only': 'Solo su questo dispositivo',
          'signed-in-disabled': 'Accesso effettuato · sincronizzazione non attiva',
          syncing: 'Connessione a Tennis Tracker Cloud in corso',
          synced: 'Sincronizzato',
          'offline-pending': 'Modifiche in attesa di connessione',
          'retryable-error': 'Errore temporaneo · nuovo tentativo disponibile',
          'needs-attention': 'È necessaria una scelta prima di continuare',
          'permanent-error': 'Sincronizzazione sospesa · intervento necessario',
        }[status]}</span>
        <small>
          {mapping?.remote_family_id
            ? `Ruolo: ${mapping.role === 'owner' ? 'proprietario' : 'membro'} · ultimo download: ${mapping.last_download_completed_at
              ? new Date(mapping.last_download_completed_at).toLocaleString('it-IT')
              : 'non completato'}`
            : 'L’accesso Google non attiva Tennis Tracker Cloud. Puoi continuare con i dati locali.'}
        </small>
      </div>
      <button className="setting-row" onClick={() => void (mapping?.enabled ? syncNow() : activate())}
        disabled={busy || !user || (status === 'needs-attention' && !mapping?.enabled)}>
        <span>{busy ? 'Sincronizzazione…' : status === 'permanent-error'
          ? 'Riprova sincronizzazione'
          : mapping?.enabled ? 'Sincronizza ora' : 'Attiva sincronizzazione'}</span><b>›</b>
      </button>
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
    </section>
    {message && <div className="toast" role="status">{message}</div>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { createMatch } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import { playerAgeCategory } from '../features/players/ageCategories';
import { fitpRankingCode } from '../features/players/fitpRankings';
import { FitpRankingOptions } from './FitpRankingOptions';
import { fitpRankingValue, useFitpRankings } from '../features/players/useFitpRankings';
import { playerFullName } from '../features/players/playerNames';
import {
  formatTournamentDate,
  localIsoDate,
  tournamentCategoryLabel,
} from '../features/tournaments/tournaments';
import { statusClassName, statusLabel } from '../features/statuses/statuses';
import { loadTournamentRows, type TournamentRow } from '../features/tournaments/tournamentRows';
import { CreationScreen, DateBox, PlusIcon, SelectBox } from './CreationScreen';
import { NewTournament } from './NewTournamentScreen';
import type { Match } from '../types';

type Step = 1 | 2 | 3;
const STEP_LABELS: Record<Step, string> = { 1: 'Passo 1 di 3 · Torneo', 2: 'Passo 2 di 3 · Giocatori', 3: 'Passo 3 di 3 · Regole' };

/** Labels for the "who serves first" choice: the player's name, and the opponent's name marked "(avversario)". */
export function ServerOptions({ playerName, opponent }: { playerName: string; opponent: string }) {
  return <>
    <option value="player">{playerName.trim() || 'Giocatore'}</option>
    <option value="opponent">{opponent.trim() ? `${opponent.trim()} (avversario)` : 'Avversario'}</option>
  </>;
}

const TrophyIcon = () => <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
  <path d="M13 5h22v15a11 11 0 0 1-22 0z" fill="#F5B82E" />
  <path d="M14 10H8v4a8 8 0 0 0 8 8M34 10h6v4a8 8 0 0 1-8 8" fill="none" stroke="#D98E0B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  <rect x="21" y="28" width="6" height="8" fill="#F5B82E" /><rect x="13" y="36" width="22" height="7" rx="3" fill="#C8F03A" />
</svg>;

/** "Nuova partita" wizard: 1. tournament (pick one or create it), 2. who plays, 3. match rules. */
export function NewMatch({ initialPlayerId, onClose }: { initialPlayerId?: string; onClose: () => void }) {
  const { activeFamily } = useFamily();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>(1);

  // Step 1: tournament
  const [chosenTournamentId, setChosenTournamentId] = useState<string | null>(null);
  const [creatingTournament, setCreatingTournament] = useState(false);
  const tournaments = useLiveQuery(
    async () => activeFamily ? loadTournamentRows(activeFamily.id) : [] as TournamentRow[],
    [activeFamily?.id],
  ) ?? [];
  // Until one is picked, the first tournament of the list (the most recent one in progress) is selected.
  const selectedRow = tournaments.find(row => row.tournament.id === chosenTournamentId)
    ?? (chosenTournamentId ? undefined : tournaments[0]);

  // Step 2: who plays
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const [matchDate, setMatchDate] = useState(localIsoDate);
  const [playerId, setPlayerId] = useState(initialPlayerId ?? '');
  const [opponent, setOpponent] = useState('');
  const selectedPlayer = players.find(player => player.id === playerId);
  const playerCategory = selectedPlayer ? playerAgeCategory(selectedPlayer, Number(matchDate.slice(0, 4))) : null;
  // FITP rankings registry. The player's current ranking is frozen in the match when it is created, together with the
  // opponent's ranking chosen here.
  const rankings = useFitpRankings();
  const playerRanking = fitpRankingCode(selectedPlayer?.ranking_id, rankings);
  const [opponentRankingId, setOpponentRankingId] = useState<number | null>(null);

  // Step 3: match rules
  const [sets, setSets] = useState<3 | 5>(3);
  const [lastSetType, setLastSetType] = useState<Match['last_set_type']>('super-tiebreak');
  const [firstServer, setFirstServer] = useState<Match['first_server']>('player');
  const [deuce, setDeuce] = useState(true);
  const [gamesToWinSet, setGamesToWinSet] = useState<4 | 6>(4);
  const [shortSetTiebreakAt, setShortSetTiebreakAt] = useState<3 | 4>(3);
  const [tiebreakTarget, setTiebreakTarget] = useState<7 | 10>(7);
  const [superTiebreakTarget, setSuperTiebreakTarget] = useState<7 | 10>(10);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [step]);

  const canAdvance = step === 1 ? Boolean(selectedRow)
    : step === 2 ? Boolean(selectedPlayer) && Boolean(opponent.trim()) && Boolean(matchDate)
      : Boolean(selectedRow && selectedPlayer && opponent.trim()) && !saving;

  function back() {
    setError(null);
    if (step === 1) onClose();
    else setStep((step - 1) as Step);
  }

  async function start() {
    if (!activeFamily || !selectedRow || !selectedPlayer) return;
    setSaving(true);
    try {
      const match = await createMatch(activeFamily.id, {
        tournament_id: selectedRow.tournament.id,
        match_date: matchDate,
        player_id: selectedPlayer.id,
        opponent,
        opponent_ranking_snapshot: opponentRankingId,
        number_of_sets: sets,
        last_set_type: lastSetType,
        super_tiebreak_target: superTiebreakTarget,
        tiebreak_target: tiebreakTarget,
        games_to_win_set: gamesToWinSet,
        short_set_tiebreak_at: shortSetTiebreakAt,
        deuce_single_point: deuce,
        first_server: firstServer,
      });
      onClose();
      navigate(`/match/${match.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare la partita.');
      setSaving(false);
    }
  }

  function next() {
    if (!canAdvance) return;
    setError(null);
    if (step === 3) void start();
    else setStep((step + 1) as Step);
  }

  const stepIndicator = <div className="cw-steps">
    {([1, 2, 3] as const).map(index => <div key={index} className={`cw-dot${index === step ? ' current' : index < step ? ' done' : ''}`} />)}
    <span>{STEP_LABELS[step]}</span>
  </div>;

  return <>
    <CreationScreen title="Nuova partita" onBack={back} header={stepIndicator} scrollRef={scrollRef}>
      {step === 1 && <div className="cw-step cw-step-tight">
        <div className="cw-step-title">In quale torneo si gioca?</div>
        {tournaments.length > 0
          ? <div className="cw-cards" role="radiogroup" aria-label="Torneo">
            {tournaments.map(({ tournament, club, status_id }) => {
              const selected = tournament.id === selectedRow?.tournament.id;
              const details = [club?.name, tournamentCategoryLabel(tournament.age_category_id), `dal ${formatTournamentDate(tournament.start_date)}`]
                .filter(Boolean).join(' • ');
              return <button key={tournament.id} type="button" role="radio" aria-checked={selected}
                className={`cw-card${selected ? ' selected' : ''}`} onClick={() => setChosenTournamentId(tournament.id)}>
                <span className="cw-card-icon"><TrophyIcon /></span>
                <span className="cw-card-text"><strong>{tournament.name}</strong><small>{details}</small></span>
                <span className={`cw-badge ${statusClassName(status_id)}`}>{statusLabel(status_id, 'tournament')}</span>
              </button>;
            })}
          </div>
          : <div className="cw-empty"><strong>Nessun torneo</strong><span>Crea il primo torneo per registrare la partita.</span></div>}
        <button type="button" className="cw-create" onClick={() => setCreatingTournament(true)}><PlusIcon />Crea un nuovo torneo</button>
        <div className="cw-hint">Dopo la creazione tornerai qui con il nuovo torneo già selezionato.</div>
      </div>}

      {step === 2 && <div className="cw-step">
        <div className="cw-step-heading">
          <div className="cw-step-title">Chi gioca?</div>
          {selectedRow && <div className="cw-summary-chip" title={selectedRow.tournament.name}><span>{selectedRow.tournament.name}</span></div>}
        </div>
        <div className="cw-field">
          <label htmlFor="data">Data partita</label>
          <DateBox id="data" value={matchDate} onChange={setMatchDate} />
        </div>
        <div className="cw-field">
          <label htmlFor="giocatore">Giocatore</label>
          <SelectBox id="giocatore" value={playerId} onChange={setPlayerId}>
            {!selectedPlayer && <option value="">Seleziona un giocatore</option>}
            {players.map(player => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}
          </SelectBox>
        </div>
        {selectedPlayer && <div className="cw-snapshot">
          <strong>{[playerRanking, playerCategory ? tournamentCategoryLabel(playerCategory.id) : ''].filter(Boolean).join('  ') || '—'}</strong>
          <span>Dati congelati alla creazione</span>
        </div>}
        {!players.length && <p className="cw-feedback">Aggiungi prima un giocatore in questo spazio.</p>}
        <div className="cw-field">
          <label htmlFor="avversario">Avversario</label>
          <input id="avversario" className="cw-input" type="text" placeholder="Nome avversario" value={opponent} onChange={event => setOpponent(event.target.value)} />
        </div>
        <div className="cw-field">
          <label htmlFor="classifica-avversario">Classifica avversario</label>
          <SelectBox id="classifica-avversario" value={opponentRankingId ?? ''} onChange={value => setOpponentRankingId(fitpRankingValue(value))}>
            <FitpRankingOptions rankings={rankings} value={opponentRankingId} />
          </SelectBox>
        </div>
      </div>}

      {step === 3 && <div className="cw-step">
        <div className="cw-step-title">Regole della partita</div>
        <div className="cw-row">
          <div className="cw-field">
            <label htmlFor="set">Set</label>
            <SelectBox id="set" value={sets} onChange={value => setSets(Number(value) as 3 | 5)}>
              <option value={3}>Al meglio dei 3</option><option value={5}>Al meglio dei 5</option>
            </SelectBox>
          </div>
          <div className="cw-field">
            <label htmlFor="ultimo-set">{sets === 3 ? 'Terzo set' : 'Quinto set'}</label>
            <SelectBox id="ultimo-set" value={lastSetType} onChange={value => setLastSetType(value as Match['last_set_type'])}>
              <option value="super-tiebreak">Super tie-break</option><option value="normal">Set completo</option>
            </SelectBox>
          </div>
        </div>
        <div className="cw-row">
          <div className="cw-field">
            <label htmlFor="game">Game per vincere il set</label>
            <SelectBox id="game" value={gamesToWinSet} onChange={value => setGamesToWinSet(Number(value) as 4 | 6)}>
              <option value={4}>4 game</option><option value={6}>6 game</option>
            </SelectBox>
          </div>
          {gamesToWinSet === 4 && <div className="cw-field">
            <label htmlFor="tbsul">Tie-break sul</label>
            <SelectBox id="tbsul" value={shortSetTiebreakAt} onChange={value => setShortSetTiebreakAt(Number(value) as 3 | 4)}>
              <option value={3}>3-3</option><option value={4}>4-4</option>
            </SelectBox>
          </div>}
        </div>
        <div className="cw-row">
          <div className="cw-field">
            <label htmlFor="tbpunti">Punti tie-break</label>
            <SelectBox id="tbpunti" value={tiebreakTarget} onChange={value => setTiebreakTarget(Number(value) as 7 | 10)}>
              <option value={7}>7 punti</option><option value={10}>10 punti</option>
            </SelectBox>
          </div>
          <div className="cw-field">
            <label htmlFor="stbpunti">Punti super tie-break</label>
            <SelectBox id="stbpunti" value={superTiebreakTarget} onChange={value => setSuperTiebreakTarget(Number(value) as 7 | 10)}>
              <option value={7}>7 punti</option><option value={10}>10 punti</option>
            </SelectBox>
          </div>
        </div>
        <div className="cw-inline">
          <label className="cw-label" htmlFor="serve">Chi serve per primo</label>
          <SelectBox id="serve" value={firstServer} onChange={value => setFirstServer(value as Match['first_server'])}>
            <ServerOptions playerName={playerFullName(selectedPlayer)} opponent={opponent} />
          </SelectBox>
        </div>
        <label className="cw-check" htmlFor="secco">Punto secco al 40-40
          <input id="secco" type="checkbox" checked={deuce} onChange={event => setDeuce(event.target.checked)} />
        </label>
      </div>}

      {error && <p className="cw-error" role="alert">{error}</p>}
      <div className="cw-actions">
        {step > 1 && <button type="button" className="cw-secondary" onClick={back}>Indietro</button>}
        <button type="button" className="cw-primary" disabled={!canAdvance} onClick={next}>
          {step === 3 && <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="#0B2A5B" stroke="#0B2A5B" strokeWidth="2" strokeLinejoin="round" /></svg>}
          {step === 3 ? 'Avvia partita' : 'Avanti'}
          {step < 3 && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>}
        </button>
      </div>
    </CreationScreen>
    {creatingTournament && <NewTournament stacked onClose={() => setCreatingTournament(false)}
      onSaved={tournament => {
        // Back to the tournament step, with the new tournament selected.
        setChosenTournamentId(tournament.id);
        setCreatingTournament(false);
        setStep(1);
      }} />}
  </>;
}

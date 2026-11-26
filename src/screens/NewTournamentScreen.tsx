import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { createTournament } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import {
  DEFAULT_TOURNAMENT_CATEGORY_ID,
  TOURNAMENT_CATEGORIES,
  localIsoDate,
  tournamentCategoryLabel,
} from '../features/tournaments/tournaments';
import { CreationScreen, DateBox, PlusIcon, SelectBox } from './CreationScreen';
import type { Tournament } from '../types';

/** "Nuovo torneo" form. The hosting club is picked from the list or created inline (it is saved with the
 *  tournament and can be reused). On save it calls `onCreated`, so the screen that opened it decides where to go:
 *  the "Nuova partita" wizard goes back to its tournament step with the new tournament selected. */
export function NewTournament({ onClose, onCreated, stacked = false }: {
  onClose: () => void;
  onCreated: (tournament: Tournament) => void;
  stacked?: boolean;
}) {
  const { activeFamily } = useFamily();
  const clubs = useLiveQuery(
    async () => activeFamily
      ? (await db.clubs.where('family_id').equals(activeFamily.id).toArray())
          .filter(club => !club.deleted)
          .sort((a, b) => a.name.localeCompare(b.name, 'it'))
      : [],
    [activeFamily?.id],
  );
  const [chosenClubId, setChosenClubId] = useState('');
  // null: follow the club list (a new club is the only choice while the family has none).
  const [newClubChosen, setNewClubChosen] = useState<boolean | null>(null);
  const [clubName, setClubName] = useState('');
  const [clubCity, setClubCity] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(DEFAULT_TOURNAMENT_CATEGORY_ID);
  const [startDate, setStartDate] = useState(localIsoDate);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasClubs = (clubs?.length ?? 0) > 0;
  const newClub = newClubChosen ?? !hasClubs;
  const clubId = clubs?.some(club => club.id === chosenClubId) ? chosenClubId : clubs?.[0]?.id ?? '';
  const clubReady = newClub ? Boolean(clubName.trim()) : Boolean(clubId);
  const canSave = Boolean(activeFamily) && clubs !== undefined && clubReady && Boolean(name.trim()) && Boolean(startDate) && !saving;

  async function save() {
    if (!activeFamily || !canSave) return;
    setSaving(true);
    try {
      const { tournament } = await createTournament(
        activeFamily.id,
        { name, age_category_id: categoryId, start_date: startDate },
        newClub ? { create: { name: clubName, city: clubCity, surface: null } } : { id: clubId },
      );
      onCreated(tournament);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare il torneo.');
      setSaving(false);
    }
  }

  return <CreationScreen title="Nuovo torneo" onBack={onClose} stacked={stacked} roomy>
    <div className="cw-step">
      <div className="cw-field">
        <div className="cw-field-heading">
          <label className="cw-label" htmlFor={newClub ? 'tclubnome' : 'tclub'}>Club</label>
          {!newClub && <button type="button" className="cw-link" onClick={() => setNewClubChosen(true)}><PlusIcon size={16} />Nuovo club</button>}
          {newClub && hasClubs && <button type="button" className="cw-link" onClick={() => setNewClubChosen(false)}>Scegli dalla lista</button>}
        </div>
        {!newClub && <SelectBox id="tclub" value={clubId} onChange={setChosenClubId}>
          {clubs?.map(club => <option key={club.id} value={club.id}>{club.city ? `${club.name} (${club.city})` : club.name}</option>)}
        </SelectBox>}
        {newClub && <div className="cw-new-club">
          <input id="tclubnome" className="cw-input" type="text" placeholder="Nome del nuovo club" autoComplete="organization"
            value={clubName} onChange={event => setClubName(event.target.value)} />
          <input id="tclubcitta" className="cw-input cw-light" type="text" placeholder="Città (facoltativo)" autoComplete="address-level2"
            aria-label="Città del nuovo club" value={clubCity} onChange={event => setClubCity(event.target.value)} />
          <p>Il club verrà salvato nella lista e potrai riusarlo.</p>
        </div>}
      </div>
      <div className="cw-field">
        <label htmlFor="tnome">Nome torneo</label>
        <input id="tnome" className="cw-input" type="text" placeholder="Es. Torneo di primavera" value={name} onChange={event => setName(event.target.value)} />
      </div>
      <div className="cw-field" role="group" aria-labelledby="tcategoria">
        <div className="cw-label" id="tcategoria">Categoria</div>
        <div className="cw-chips">
          {TOURNAMENT_CATEGORIES.map(category => <button key={category.id} type="button"
            className={category.id === categoryId ? 'selected' : ''} aria-pressed={category.id === categoryId}
            onClick={() => setCategoryId(category.id)}>{tournamentCategoryLabel(category.id)}</button>)}
        </div>
      </div>
      <div className="cw-field">
        <label htmlFor="tdata">Data di inizio</label>
        <DateBox id="tdata" value={startDate} onChange={setStartDate} />
      </div>
      {error && <p className="cw-error" role="alert">{error}</p>}
    </div>
    <div className="cw-actions">
      <button className="cw-primary" disabled={!canSave} onClick={() => void save()}><PlusIcon size={22} color="#0B2A5B" />Crea torneo</button>
    </div>
  </CreationScreen>;
}

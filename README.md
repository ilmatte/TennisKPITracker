# Tennis KPI Tracker

## Regole di conteggio del punteggio

Le opzioni si scelgono quando si crea la partita. Il motore applica le stesse impostazioni anche modificando una partita esistente.

### Formato e vittoria della partita

- **Al meglio dei 3 set:** vince chi conquista 2 set. Se è selezionato **Normale**, il terzo set è un set ordinario; con **Super tie-break**, il terzo set è sostituito da un super tie-break decisivo.
- **Al meglio dei 5 set:** vince chi conquista 3 set e il match si arresta al raggiungimento di 3 set vinti. Se il set decisivo è **Normale**, anche il quinto è ordinario. Se è selezionato **Super tie-break**, il quinto set resta ordinario e il tie-break previsto alla fine del set diventa un super tie-break.
- Dopo che un giocatore ha raggiunto il numero di set necessario, non è possibile registrare altri punti.

### Set ordinari

- **Set a 6 game** (opzione “Set brevi” disattivata): vince chi arriva ad almeno 6 game con 2 game di vantaggio. Sul 6-6 si gioca un tie-break.
- **Set a 4 game:** vince chi arriva ad almeno 4 game con 2 game di vantaggio, oppure vince il tie-break previsto dalla soglia selezionata.
- Per i set a 4 game si può scegliere se giocare il tie-break sul 3-3 o continuare con vantaggio fino al 4-4. La scelta predefinita è 3-3.
- Il tie-break ordinario si gioca a 7 o 10 punti (predefinito 7), con almeno 2 punti di scarto. Il vincitore del tie-break vince il set.
- Nel set decisivo al meglio dei 5 con **Super tie-break**, il super tie-break sostituisce il tie-break ordinario alla soglia prevista (3-3 nei set brevi, 6-6 nei set a 6 game). Il suo target predefinito è 10, sempre con 2 punti di scarto.
- Il super tie-break decisivo al meglio dei 3 sostituisce l’intero terzo set e usa lo stesso target configurato per il super tie-break.

I target dei tie-break sono modificabili nella schermata di modifica della partita. La creazione usa 7 e 10 come valori predefiniti.

### Configurazioni non esposte nella creazione

La schermata di creazione usa 4 game, tie-break sul 3-3, target tie-break 7 e target super tie-break 10 come valori predefiniti. Entrambi i target si possono impostare solo a 7 o 10 punti, sia in creazione sia dall’editor durante la partita. Anche game per set, soglia del tie-break e punto secco restano modificabili durante la partita. In ogni tie-break servono almeno 2 punti di vantaggio.

## Regole di alternanza del servizio

- Il primo battitore è quello selezionato in creazione. Nei game normali ciascun giocatore serve per un game intero e i battitori si alternano dopo ogni game. L’alternanza continua tra i set senza ripartire da capo.
- Nel tie-break e nel super tie-break, chi inizia serve il primo punto; l’avversario serve i due successivi. Da lì ciascun giocatore serve per due punti, alternandosi fino alla fine. Il target configurato deve essere raggiunto con almeno 2 punti di vantaggio.
- Il primo battitore del tie-break riceve nel primo game del set successivo: quindi serve il giocatore che non ha iniziato il tie-break. Il servizio del primo punto di ogni game viene registrato insieme al punto; il primo battitore della partita resta salvato nella configurazione del match. Questi dati consentono di ricostruire l’alternanza anche dopo la chiusura e riapertura dell’app.
- I super tie-break decisivi terminano la partita, quindi non hanno un game successivo.
- Nei tie-break e nei super tie-break si cambia campo dopo ogni 6 punti. Nei game normali il cambio campo segue la regola dei game dispari: dopo il primo game e poi dopo ogni ulteriore numero dispari di game. Il tracker mostra un promemoria al momento del cambio.

Local-first tennis match tracking PWA built with React, TypeScript, Vite, Dexie/IndexedDB, Supabase Auth, and Supabase PostgreSQL.

## Local development

```sh
npm install
npm run dev
npm test
npm run build
```

The app remains usable without signing in or connecting to the internet. To enable Google sign-in and shared-family management, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable/anon key) in `.env.local` and in the required Vercel environments. Google OAuth credentials belong in Supabase Auth configuration. Never put a Google client secret or Supabase `service_role` key in frontend code or environment variables.

## Supabase database setup

`supabase/initial_schema.sql` is the single, consolidated schema script. It defines families, members, one-time email invitations, family-scoped sporting records (players, clubs, tournaments, matches, sets, games, points), the `point_types` and `player_age_categories` reference tables, RLS policies, family-management functions and the cross-device sync protocol (ordered per-family change log and version-checked write/read RPCs; authenticated users have no direct write access to sporting tables). The script is delivered for manual review and is never run by the app or build. If `pgcrypto` is absent, it installs it in `extensions`; if it already exists elsewhere, the schema uses its actual namespace without moving the extension. The `private` schema contains RLS helper functions and must not be added to Supabase's exposed API schemas.

For a **new, empty** Supabase project, run `initial_schema.sql` once in the Supabase SQL Editor.

For a project created **before clubs** existed, run `002_clubs.sql` (idempotent, safe to re-run) before deploying the app version with clubs. It adds the `clubs` table — family data with the same access rules as players: members read, writes go through the sync functions — and lets the sync tables and functions (`apply_sync_record`, `list_initial_snapshot`) accept the new `clubs` entity type. A project with it applied has the same schema as one created from the current `initial_schema.sql`.

For a project created **before tournaments** existed, run `003_tournaments.sql` (idempotent, safe to re-run; it needs the `clubs` table, so run `002_clubs.sql` first if needed) before deploying the app version with tournaments. It adds the `tournaments` table — family data with the same access rules as clubs, each tournament linked to its club (`club_id`) and to an age category (`age_category_id` → `player_age_categories`; the app offers U12 to Open) — adds the nullable `matches.tournament_id` foreign key, and lets the sync tables and functions accept the new `tournaments` entity type. It **drops the free-text `matches.tournament` column** and the names stored in it (export a backup or copy them first if you need them); matches created before tournaments keep `tournament_id` null. A project with it applied has the same schema as one created from the current `initial_schema.sql`.

The script replaces every earlier incremental migration: set-format options, `points.won`, `points.serving`, `point_types`, removal of the point error-detail fields, `player_age_categories`, removal of `players.category`, `matches.opponent_category` and the match snapshots of the player's name and category. A project that already applied all of them has exactly the same schema as one created from the current script — verified by comparing the PostgreSQL catalog (columns and their order, constraints, indexes, policies, functions, privileges, RLS, reference rows) of both databases — so it needs no action. A project at an older schema version has no upgrade script in the repository any more: the removed migrations are available in the git history.

Reference tables (read-only for signed-in users, not synchronized; their ids are mirrored by the app and must never be renumbered):

- `point_types` (`src/features/scoring/pointTypes.ts`): `1` double_fault, `2` free_error, `3` lose, `4` win, `5` ace, `6` great_shot. Like `points.won` (my player won the point) and `points.serving` (my player served it), every point type refers to my player.
- `player_age_categories` (`src/features/players/ageCategories.ts`): the FITP age categories U12, U14, U16, U18, Open and Over 30 … Over 80, with their age thresholds (`min_age` inclusive, `max_age` exclusive) and how the age is measured (`january_1`: years completed on 1 January of the sporting year, for youth categories and Open; `calendar_year`: age reached during the year, for veterans). The veterans categories are currently inactive (`is_active = false`), so adult players are attributed to Open. A player's age category is not stored: it is computed from `players.birth_date`, independently from the FITP technical ranking (`players.ranking`).

Matches store the player's id only: the player's name is read from `players` through `matches.player_id`, so renaming a player changes the name shown in all of their matches. `matches.player_ranking_snapshot` keeps the ranking at the time the match was created.

Configure Google as an enabled Supabase Auth provider and allow the app's redirect URL, including `http://localhost:5173/` for local development and the production app URL when deployed. Only a family owner can create invitations. Invitations use a random one-time token; only its SHA-256 hash is stored in PostgreSQL, and the token expires after seven days. The app provides a link that the inviter can send to the invited email address. Acceptance requires a signed-in account with a confirmed email matching the invitation.

## Local database and privacy

Dexie uses a single schema version (`src/db/database.ts`) whose stores mirror the Supabase tables: the sport records have the same fields as the corresponding PostgreSQL rows, so sync sends records without any conversion. IndexedDB cannot index boolean values, so fields such as `points.won` and `points.serving` are stored but not indexed. The schema also contains the local-only `syncQueue`, `syncMetadata` and `syncConflicts` stores. The `point_types` and `player_age_categories` reference stores are written every time the database opens; the write is keyed by id, so it never creates duplicates.

The schema version number is 10, the last version that shipped with step-by-step migrations: browsers refuse to open a database with a lower version than the one already stored on the device, so the number cannot go back. The step-by-step upgrades were removed; a device whose local database is older than version 10 opens with the current stores and reference data, but its existing records are not converted. Later schema changes add their own versions: `version(11)` adds the `clubs` store, `version(12)` the `tournaments` store and the `matches.tournament_id` index, and removes the free-text `tournament` field from local matches; each further change adds a new version. JSON backups written with the older point fields (backup version 2) are still converted on restore.

The app automatically creates and reuses one technical local workspace. It remains usable without signing in. Google login alone neither creates a remote family nor activates sync; the user must explicitly activate sync in Settings. A member accepting an invitation is associated with that existing remote family and downloads its data if the local device has no independent sports records. If it does have local sports data, automatic association/download is paused and the app records a needs-attention state instead of merging or overwriting anything.

Players, matches, sets, games, and points keep their UUIDs. A persistent local mapping relates the local workspace UUID to the remote family UUID, authenticated user, and role. Sports rows retain the local family UUID in Dexie; remote requests translate it through that mapping. Local records and queue operations remain transactionally stored. Upload is ordered by foreign-key dependency, tombstones are upserted, initial downloads are paginated/checkpointed, and incremental downloads use the server change log. Concurrent edits are saved as local conflicts; neither version silently overwrites the other.

The synchronization implementation and SQL migration are not a substitute for production verification. PostgreSQL concurrency, RPC privileges, and RLS have not been exercised against a live or isolated Supabase instance. Do not activate sync until the reviewed SQL migration has been applied to the intended Supabase project. No remote project is modified by this repository change.

Family owners can revoke member access and delete a family. RLS restricts remote family and sporting-data access to current members; application users never receive an elevated service-role credential.

## Il campo `version` e i conflitti di sincronizzazione

Tutte le tabelle sincronizzate (`players`, `matches`, `sets`, `games`, `points`) hanno un campo `version`: è un **contatore delle modifiche** del record. Non ha un significato tennistico; serve alla sincronizzazione per capire se due dispositivi hanno modificato lo stesso record nello stesso momento.

- Un record nuovo nasce con `version = 1`. Ogni modifica, compresa l’eliminazione logica (`deleted = true`), incrementa il numero di 1 (`updated()` in `src/db/sportsMutations.ts`).
- Quando l’app invia una modifica a Supabase, manda il record insieme alla **versione di base**, cioè la versione da cui è partita la modifica.
- La funzione di sincronizzazione su Supabase confronta la versione di base con quella salvata:
  - se **coincidono**, nessun altro ha modificato il record nel frattempo: la modifica viene applicata e il server assegna la versione successiva;
  - se **non coincidono**, un altro dispositivo ha modificato lo stesso record nel frattempo: il server non sovrascrive nulla e segnala un **conflitto**, che si risolve in Impostazioni scegliendo quale versione tenere.
- In ricezione, un dispositivo ignora le modifiche con versione uguale o più vecchia di quella che ha già (`src/sync/syncEngine.ts`), così una modifica vecchia non sovrascrive mai una più recente.

Esempio: il punto 3 è alla versione 2 su due telefoni, A e B. A cambia il battitore (versione 3) e si sincronizza: Supabase ora ha la versione 3. B, ancora offline, cambia il numero di colpi partendo dalla versione 2. Quando B si sincronizza dichiara “parto dalla 2”, ma Supabase ha la 3: viene segnalato un conflitto invece di perdere silenziosamente la modifica di A.

## Vercel deployment

1. Import the repository into Vercel with the Vite framework preset.
2. Set build command `npm run build` and output directory `dist`.
3. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only where authentication and family management are enabled.

## iPhone installation

Open the deployed HTTPS URL in Safari, choose Share, then Add to Home Screen. The PWA caches app resources and uses IndexedDB for local match data.

## Data safety

- IndexedDB is the operational store; scoring and KPI features remain available offline.
- Match snapshots remain independent from later player-profile changes.
- Family deletion removes local cached family records on the device performing the deletion; remote deletion cascades through that family's data.
- JSON backups are version 3 and scoped to the active family; they include clubs and tournaments (backups without them are still accepted). Restore also accepts version 2 backups and converts their points to the current point fields.
- Sync activation is explicit; when enabled, the app syncs on startup, foreground/connection restoration, local queued changes, or manual request. iOS background sync is not assumed.

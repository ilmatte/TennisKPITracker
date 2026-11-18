# Tennis KPI Tracker

Local-first tennis match tracking PWA built with React, TypeScript, Vite, Dexie/IndexedDB, Supabase, Recharts, and Workbox.

## Local development

```sh
npm install
npm run dev
npm test
npm run build
```

Open the Vite URL shown in the terminal. The app works locally without Supabase or Google credentials.

## Environment

The local development environment does not need Supabase credentials. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only in Vercel's **Production** environment when cloud integration is implemented. Never expose the Supabase `service_role` key in the frontend.

## Supabase setup

1. Create a Supabase project.
2. For a new database, run `supabase/001_schema.sql` in the SQL Editor. If the old `supabase/schema.sql` was already applied, run `supabase/002_normalize_sets_games.sql` instead to migrate existing data without losing points.
3. Keep all personal tables protected by the included RLS policies.

The schema stores match snapshot fields for player name, ranking, category, and match date. Profile updates must never replace those fields.

## Next steps: Google sign-in and cloud sync

Google authentication and synchronization are not implemented in the app yet. Continue with these steps:

1. Configure Google as an OAuth provider in Supabase and add the Google OAuth client credentials there. Keep the OAuth client secret out of the frontend and source code.
2. Set the OAuth callback and allowed redirect URLs in Supabase and the Google Cloud Console, including the deployed Vercel app URL.
3. Implement Supabase sign-in/sign-out in the app and restore the authenticated user's session.
4. Implement synchronization between local IndexedDB and Supabase, associating records with the authenticated user and handling conflicts. Follow the normalized relationship `match → set → game → point`.
5. Add `VITE_SUPABASE_URL` and the publishable/anon key to Vercel's **Production** environment only. Use RLS for access control; never put a `service_role` key in the frontend.


1. Configurare Google come provider in Supabase, inserendo le credenziali OAuth dell’app Google. Il secret OAuth va configurato in Supabase, mai nel codice o nelle variabili pubbliche di Vercel.
2. Impostare URL di callback e redirect in Supabase e nella console Google, includendo il dominio Vercel dell’app.
3. Implementare nell’app il login/logout con Supabase, il recupero della sessione e l’interfaccia per l’utente autenticato.
4. Implementare la sincronizzazione tra i dati locali e le tabelle Supabase, gestendo conflitti e associazione dei dati all’utente. Il database normalizzato ora prevede la relazione partita → set → game → punto, quindi va rispettata anche dalla sincronizzazione.
5. Tenere le chiavi Supabase pubbliche nel frontend e affidarsi a RLS per l’autorizzazione; non usare mai una chiave service_role.

## Vercel deployment

1. Push the repository to GitHub.
2. Import it into Vercel.
3. Use framework preset Vite.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. When cloud integration is implemented, add the `VITE_SUPABASE_*` variables to the **Production** environment in Project Settings.

Google Drive configuration is optional.

## iPhone installation

Open the deployed HTTPS URL in Safari, choose Share, then Add to Home Screen. The app uses a service worker for app resources and IndexedDB for match data.

## Data safety

- Points and profile changes are saved locally first.
- Deleting a profile does not delete historical matches or snapshots.
- Match snapshots remain independent from the live player profile.
- JSON export/import preserves records and unique identifiers.
- Cloud synchronization never blocks point capture.

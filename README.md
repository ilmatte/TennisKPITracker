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

The app works locally without Supabase credentials. To enable Google sign-in locally, put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the publishable/anon key) in `.env.local`; set the same public variables in the Vercel environments where sign-in is enabled. Never expose the Supabase `service_role` key or Google OAuth client secret in the frontend.

## Supabase setup

1. Create a Supabase project.
2. For a new database, run `supabase/001_schema.sql` in the SQL Editor. If the old `supabase/schema.sql` was already applied, run `supabase/002_normalize_sets_games.sql` instead to migrate existing data without losing points.
3. Keep all personal tables protected by the included RLS policies.

The schema stores match snapshot fields for player name, ranking, category, and match date. Profile updates must never replace those fields.

## Google sign-in and cloud sync

Google sign-in is implemented through Supabase Auth using PKCE. Configure Google as an enabled provider in Supabase and set the app's Site URL and allowed redirect URL (for local development, `http://localhost:5173/`). The app sends users back to the root URL; Supabase processes the PKCE callback and restores the session automatically. The application remains usable offline and without authentication. Sign-in requires the public Supabase URL and publishable/anon key; no Google secret or Supabase `service_role` key belongs in frontend environment variables.

Cloud synchronization between local IndexedDB and Supabase is not implemented. When it is added, associate records with the authenticated user, handle conflicts, and follow the normalized relationship `match → set → game → point`; use RLS for access control.


1. Configurare Google come provider in Supabase, inserendo le credenziali OAuth dell’app Google. Il secret OAuth va configurato in Supabase, mai nel codice o nelle variabili pubbliche di Vercel.
2. Consentire in Supabase gli URL di redirect dell’app, incluso `http://localhost:5173/` in sviluppo e l’URL di produzione quando applicabile.
3. Per abilitare l’accesso, impostare `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nell’ambiente frontend; non usare mai una chiave `service_role`.
4. La sincronizzazione cloud dei dati locali non è implementata.

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

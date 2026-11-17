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

Copy `.env.example` to `.env.local`:

```sh
cp .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable cloud synchronization. Never use the Supabase `service_role` key in the frontend.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. Enable Email/Password authentication.
4. Add the environment variables to Vercel.
5. Keep all personal tables protected by the included RLS policies.

The schema stores match snapshot fields for player name, ranking, category, and match date. Profile updates must never replace those fields.

## Vercel deployment

1. Push the repository to GitHub.
2. Import it into Vercel.
3. Use framework preset Vite.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Add the `VITE_SUPABASE_*` variables in Project Settings.

Google Drive configuration is optional.

## iPhone installation

Open the deployed HTTPS URL in Safari, choose Share, then Add to Home Screen. The app uses a service worker for app resources and IndexedDB for match data.

## Data safety

- Points and profile changes are saved locally first.
- Deleting a profile does not delete historical matches or snapshots.
- Match snapshots remain independent from the live player profile.
- JSON export/import preserves records and unique identifiers.
- Cloud synchronization never blocks point capture.

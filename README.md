# Tennis KPI Tracker

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

`supabase/001_initial_schema.sql` is the only supported initial schema. It defines families, members, one-time email invitations, and family-scoped players, matches, sets, games, and points, including RLS policies and family-management functions. Authenticated users can soft-delete sporting records through family-scoped updates; physical deletion is reserved for owner-checked family deletion, which cascades to its dependent data. If `pgcrypto` is absent, it is installed in `extensions`; if it already exists elsewhere, the schema uses its actual namespace without moving the extension. The `private` schema contains RLS helper functions and must not be added to Supabase's exposed API schemas. Shared-family deletion is available only through the owner-checked `delete_family` RPC.

For a **new, empty** Supabase project, run `001_initial_schema.sql` once in the Supabase SQL Editor.

For a project with former Tennis KPI tables, review `supabase/000_reset_application.sql` carefully. It is **destructive** and removes only the application's listed tables and functions (including the RLS helpers in `private`); it does not use `CASCADE` and does not touch Supabase Auth or OAuth configuration. Only after verifying the script and confirming the application data can be discarded, run it manually in the SQL Editor, then run `001_initial_schema.sql`. Neither script is executed by the app or build.

Configure Google as an enabled Supabase Auth provider and allow the app's redirect URL, including `http://localhost:5173/` for local development and the production app URL when deployed. Only a family owner can create invitations. Invitations use a random one-time token; only its SHA-256 hash is stored in PostgreSQL, and the token expires after seven days. The app provides a link that the inviter can send to the invited email address. Acceptance requires a signed-in account with a confirmed email matching the invitation.

## Local database and privacy

Dexie uses a versioned database with family-scoped stores. Upgrading the previous Dexie version to the relational schema clears its old `players`, `matches`, `points`, and pending sync-queue records **once** as part of the version migration. The point-numbering migration preserves every current record, deterministically renumbers any duplicate point numbers (including deleted points), and then adds a unique compound index on `(game_id, point_number)`. Later app starts do not clear data. Old local backups use the previous shape and are not accepted as version 2 relational backups. Export any old data separately before deploying if it must be retained.

The new local database starts without sample players. Create a local-only workspace to use the app without an account, or create/join a shared family while signed in. Local-only workspaces are scoped to the current signed-in account after explicit association. Changing or signing out of an account hides that account's shared-family workspaces from the other account.

`sets`, `games`, and `points` are stored as related entities with client-generated UUIDs. Points link to a game, games to a set, and sets to a match. Records and their local outbox entries are written in Dexie transactions. The outbox is preparation for a later sync engine; **sporting data is not currently uploaded or downloaded**, even for shared families. A family currently shares membership and invitations, not match/player data. Do not treat this version as cloud backup or cross-device synchronization.

Family owners can revoke member access and delete a family. RLS restricts remote family and sporting-data access to current members; application users never receive an elevated service-role credential.

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
- JSON backups are version 2 and scoped to the active family.
- No automatic cloud sync is implemented.

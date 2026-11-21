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

`supabase/001_initial_schema.sql` defines families, members, one-time email invitations, family-scoped sporting records, RLS, and family-management functions. For an existing installation, review and apply `002_single_workspace_per_owner.sql` if the one-owner-family constraint is not already present. Apply `003_sync_protocol.sql` before activating cross-device sync; it adds an ordered per-family change log and version-checked write/read RPCs, and removes direct authenticated write access to sporting tables. These SQL scripts are delivered for manual review and are never run by the app or build. If `pgcrypto` is absent, the initial schema installs it in `extensions`; if it already exists elsewhere, the schema uses its actual namespace without moving the extension. The `private` schema contains RLS helper functions and must not be added to Supabase's exposed API schemas.

For a **new, empty** Supabase project, run `001_initial_schema.sql`, then `003_sync_protocol.sql`, in the Supabase SQL Editor. `002_single_workspace_per_owner.sql` is incremental and may also be run when desired; its duplicate-owner check stops rather than deleting or merging data.

For a project with former Tennis KPI tables, review `supabase/000_reset_application.sql` carefully. It is **destructive** and removes only the application's listed tables and functions (including the RLS helpers in `private`); it does not use `CASCADE` and does not touch Supabase Auth or OAuth configuration. Only after verifying the script and confirming the application data can be discarded, run it manually in the SQL Editor, then run `001_initial_schema.sql`. Neither script is executed by the app or build.

Configure Google as an enabled Supabase Auth provider and allow the app's redirect URL, including `http://localhost:5173/` for local development and the production app URL when deployed. Only a family owner can create invitations. Invitations use a random one-time token; only its SHA-256 hash is stored in PostgreSQL, and the token expires after seven days. The app provides a link that the inviter can send to the invited email address. Acceptance requires a signed-in account with a confirmed email matching the invitation.

## Local database and privacy

Dexie uses a versioned database with family-scoped sports stores. Dexie schema version 2 additively creates sync metadata and conflict stores; it preserves existing workspaces, sporting records, UUIDs, tombstones, and queued operations. It does not reset or delete the local database. The one-time reset for the earlier development schema is already guarded by its local marker and is not repeated by this sync change.

The app automatically creates and reuses one technical local workspace. It remains usable without signing in. Google login alone neither creates a remote family nor activates sync; the user must explicitly activate sync in Settings. A member accepting an invitation is associated with that existing remote family and downloads its data if the local device has no independent sports records. If it does have local sports data, automatic association/download is paused and the app records a needs-attention state instead of merging or overwriting anything.

Players, matches, sets, games, and points keep their UUIDs. A persistent local mapping relates the local workspace UUID to the remote family UUID, authenticated user, and role. Sports rows retain the local family UUID in Dexie; remote requests translate it through that mapping. Local records and queue operations remain transactionally stored. Upload is ordered by foreign-key dependency, tombstones are upserted, initial downloads are paginated/checkpointed, and incremental downloads use the server change log. Concurrent edits are saved as local conflicts; neither version silently overwrites the other.

The synchronization implementation and SQL migration are not a substitute for production verification. PostgreSQL concurrency, RPC privileges, and RLS have not been exercised against a live or isolated Supabase instance. Do not activate sync until the reviewed SQL migration has been applied to the intended Supabase project. No remote project is modified by this repository change.

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
- Sync activation is explicit; when enabled, the app syncs on startup, foreground/connection restoration, local queued changes, or manual request. iOS background sync is not assumed.

-- points.server ('player' | 'opponent') becomes points.serving (boolean):
-- true when my player served the point, false when the opponent served it.
--
-- Run this BEFORE deploying the app version that writes `serving`: clients still running the old
-- version would send `server`, and the sync upsert would fail on the new not-null column.
-- Requires 003_points_won_boolean.sql to have been applied first.

begin;

alter table public.points add column if not exists serving boolean;

update public.points
set serving = (server = 'player')
where serving is null;

alter table public.points alter column serving set not null;
alter table public.points drop column if exists server;

-- Sync history: convert stored point payloads so that clients only ever receive `serving`.
update public.sync_changes
set payload = (payload - 'server') || pg_catalog.jsonb_build_object('serving', payload ->> 'server' = 'player')
where entity_type = 'points' and payload ? 'server';

update public.sync_entity_snapshots
set payload = (payload - 'server') || pg_catalog.jsonb_build_object('serving', payload ->> 'server' = 'player')
where entity_type = 'points' and payload ? 'server';

-- Idempotency results replayed to clients that retry an already-applied operation.
update public.sync_operations
set result = pg_catalog.jsonb_set(
  result,
  '{record}',
  ((result -> 'record') - 'server') || pg_catalog.jsonb_build_object('serving', result -> 'record' ->> 'server' = 'player')
)
where entity_type = 'points' and result -> 'record' ? 'server';

commit;

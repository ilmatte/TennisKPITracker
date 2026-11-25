-- points.winner ('player' | 'opponent') becomes points.won (boolean):
-- true when my player won the point, false when the opponent won it.
--
-- Run this BEFORE deploying the app version that writes `won`: clients still running the old
-- version would send `winner`, and the sync upsert would fail on the new not-null column.

begin;

alter table public.points add column if not exists won boolean;

update public.points
set won = (winner = 'player')
where won is null;

alter table public.points alter column won set not null;
alter table public.points drop column if exists winner;

-- Sync history: convert stored point payloads so that clients only ever receive `won`.
update public.sync_changes
set payload = (payload - 'winner') || pg_catalog.jsonb_build_object('won', payload ->> 'winner' = 'player')
where entity_type = 'points' and payload ? 'winner';

update public.sync_entity_snapshots
set payload = (payload - 'winner') || pg_catalog.jsonb_build_object('won', payload ->> 'winner' = 'player')
where entity_type = 'points' and payload ? 'winner';

-- Idempotency results replayed to clients that retry an already-applied operation.
update public.sync_operations
set result = pg_catalog.jsonb_set(
  result,
  '{record}',
  ((result -> 'record') - 'winner') || pg_catalog.jsonb_build_object('won', result -> 'record' ->> 'winner' = 'player')
)
where entity_type = 'points' and result -> 'record' ? 'winner';

commit;

-- Removes matches.player_category_snapshot: the age category is computed from players.birth_date.
-- Run it after 003, BEFORE deploying the app version without this field. Safe to re-run.

begin;

alter table public.matches drop column if exists player_category_snapshot;

-- Sync history: remove the field from stored payloads so that clients never receive it again.
update public.sync_changes set payload = payload - 'player_category_snapshot'
where entity_type = 'matches' and payload ? 'player_category_snapshot';

update public.sync_entity_snapshots set payload = payload - 'player_category_snapshot'
where entity_type = 'matches' and payload ? 'player_category_snapshot';

update public.sync_operations
set result = pg_catalog.jsonb_set(result, '{record}', (result -> 'record') - 'player_category_snapshot')
where entity_type = 'matches' and result -> 'record' ? 'player_category_snapshot';

commit;

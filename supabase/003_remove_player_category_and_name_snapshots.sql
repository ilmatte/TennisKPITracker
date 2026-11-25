-- Removes columns that are now computed or read elsewhere:
--   players.category                      -> computed from players.birth_date (player_age_categories);
--   matches.player_first_name_snapshot,
--   matches.player_last_name_snapshot     -> the name is read from players through matches.player_id;
--   matches.opponent_category             -> no longer recorded.
-- matches.player_category_snapshot is removed separately by 004_remove_match_category_snapshot.sql.
--
-- Run it BEFORE deploying the app version without these fields. Safe to re-run.

begin;

alter table public.players drop column if exists category;

alter table public.matches
  drop column if exists player_first_name_snapshot,
  drop column if exists player_last_name_snapshot,
  drop column if exists opponent_category;

-- Sync history: remove the same fields from stored payloads so that clients never receive them again.
update public.sync_changes set payload = payload - 'category'
where entity_type = 'players' and payload ? 'category';
update public.sync_changes
set payload = payload - 'player_first_name_snapshot' - 'player_last_name_snapshot' - 'opponent_category'
where entity_type = 'matches' and payload ?| array['player_first_name_snapshot', 'player_last_name_snapshot', 'opponent_category'];

update public.sync_entity_snapshots set payload = payload - 'category'
where entity_type = 'players' and payload ? 'category';
update public.sync_entity_snapshots
set payload = payload - 'player_first_name_snapshot' - 'player_last_name_snapshot' - 'opponent_category'
where entity_type = 'matches' and payload ?| array['player_first_name_snapshot', 'player_last_name_snapshot', 'opponent_category'];

update public.sync_operations
set result = pg_catalog.jsonb_set(result, '{record}', (result -> 'record') - 'category')
where entity_type = 'players' and result -> 'record' ? 'category';
update public.sync_operations
set result = pg_catalog.jsonb_set(result, '{record}',
  (result -> 'record') - 'player_first_name_snapshot' - 'player_last_name_snapshot' - 'opponent_category')
where entity_type = 'matches'
  and result -> 'record' ?| array['player_first_name_snapshot', 'player_last_name_snapshot', 'opponent_category'];

commit;

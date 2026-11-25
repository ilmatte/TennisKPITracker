-- Removes points.error_player, points.error_category and points.pressure_error_player.
--
-- The point type now always refers to my player (like points.won): free_error means my player's free error, so the
-- point is lost. Points recorded as a free error but won (the opponent's free error) become ordinary won points (4).
--
-- Requires 005_point_types.sql. Safe to run on a database created from initial_schema.sql with data, after 002-005,
-- and safe to re-run. Run it BEFORE deploying the app version without these fields.

begin;

update public.points
set point_type_id = 4
where point_type_id = 2 and won;

alter table public.points
  drop column if exists error_player,
  drop column if exists error_category,
  drop column if exists pressure_error_player;

-- Sync history: same conversion on stored point payloads.
create or replace function pg_temp.convert_point_payload(payload jsonb) returns jsonb
language sql immutable as $$
  select (payload - 'error_player' - 'error_category' - 'pressure_error_player')
    || case
      when (payload ->> 'point_type_id') = '2' and coalesce((payload ->> 'won')::boolean, false)
        then pg_catalog.jsonb_build_object('point_type_id', 4)
      else '{}'::jsonb
    end
$$;

update public.sync_changes
set payload = pg_temp.convert_point_payload(payload)
where entity_type = 'points'
  and (payload ?| array['error_player', 'error_category', 'pressure_error_player']
    or ((payload ->> 'point_type_id') = '2' and coalesce((payload ->> 'won')::boolean, false)));

update public.sync_entity_snapshots
set payload = pg_temp.convert_point_payload(payload)
where entity_type = 'points'
  and (payload ?| array['error_player', 'error_category', 'pressure_error_player']
    or ((payload ->> 'point_type_id') = '2' and coalesce((payload ->> 'won')::boolean, false)));

update public.sync_operations
set result = pg_catalog.jsonb_set(result, '{record}', pg_temp.convert_point_payload(result -> 'record'))
where entity_type = 'points'
  and (result -> 'record' ?| array['error_player', 'error_category', 'pressure_error_player']
    or ((result -> 'record' ->> 'point_type_id') = '2' and coalesce((result -> 'record' ->> 'won')::boolean, false)));

commit;

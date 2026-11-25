-- Point types lookup table. points.double_fault / points.free_error are replaced by points.point_type_id (FK);
-- points.attack_error and points.pressure_situation are removed.
--
-- Point types (ids are stable and mirrored by the app, see src/features/scoring/pointTypes.ts):
--   1 double_fault, 2 free_error, 3 lose, 4 win, 5 ace, 6 great_shot
--
-- Existing points are classified from the removed flags:
--   double_fault -> 1, otherwise free_error -> 2, otherwise won -> 4 (win), otherwise 3 (lose).
--   Aces and great shots recorded before this migration cannot be told apart from ordinary won points.
--
-- Requires 003_points_won_boolean.sql (points.won). Safe to run on a database created from initial_schema.sql
-- with data, after 002-004. Run it BEFORE deploying the app version that writes point_type_id.

begin;

create table if not exists public.point_types (
  id smallint primary key,
  code text not null unique,
  label text not null
);

insert into public.point_types (id, code, label) values
  (1, 'double_fault', 'Doppio fallo'),
  (2, 'free_error', 'Errore gratuito'),
  (3, 'lose', 'Perso'),
  (4, 'win', 'Vinto'),
  (5, 'ace', 'Ace'),
  (6, 'great_shot', 'Bel colpo')
on conflict (id) do update set code = excluded.code, label = excluded.label;

revoke all on table public.point_types from public, anon;
grant select on table public.point_types to authenticated;
alter table public.point_types enable row level security;
drop policy if exists "authenticated users can read point types" on public.point_types;
create policy "authenticated users can read point types"
  on public.point_types for select to authenticated
  using (true);

alter table public.points add column if not exists point_type_id smallint;

do $$
begin
  -- Only classify from the legacy flags while they still exist (the script may be re-run).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'points' and column_name = 'double_fault'
  ) then
    update public.points
    set point_type_id = case
      when double_fault then 1
      when free_error then 2
      when won then 4
      else 3
    end
    where point_type_id is null;
  end if;
end $$;

alter table public.points alter column point_type_id set not null;
alter table public.points
  drop constraint if exists points_point_type_id_fkey,
  add constraint points_point_type_id_fkey foreign key (point_type_id) references public.point_types(id);
create index if not exists points_point_type_idx on public.points(point_type_id);

alter table public.points
  drop column if exists double_fault,
  drop column if exists free_error,
  drop column if exists attack_error,
  drop column if exists pressure_situation;

-- Sync history: convert stored point payloads so that clients only ever receive point_type_id.
create or replace function pg_temp.convert_point_payload(payload jsonb) returns jsonb
language sql immutable as $$
  select (payload - 'double_fault' - 'free_error' - 'attack_error' - 'pressure_situation')
    || pg_catalog.jsonb_build_object('point_type_id', case
      when coalesce((payload ->> 'double_fault')::boolean, false) then 1
      when coalesce((payload ->> 'free_error')::boolean, false) then 2
      when coalesce((payload ->> 'won')::boolean, false) then 4
      else 3
    end)
$$;

update public.sync_changes
set payload = pg_temp.convert_point_payload(payload)
where entity_type = 'points' and payload ? 'double_fault';

update public.sync_entity_snapshots
set payload = pg_temp.convert_point_payload(payload)
where entity_type = 'points' and payload ? 'double_fault';

update public.sync_operations
set result = pg_catalog.jsonb_set(result, '{record}', pg_temp.convert_point_payload(result -> 'record'))
where entity_type = 'points' and result -> 'record' ? 'double_fault';

commit;

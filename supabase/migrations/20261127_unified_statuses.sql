-- Incremental migration: one statuses reference table for tournaments and matches.
-- Run it after 20261127_tournament_status.sql. New databases get the same result directly from
-- supabase/initial_schema.sql.
--
-- * Adds public.statuses: 1 upcoming (In programma), 2 in_progress (In corso), 3 completed (Concluso / Conclusa),
--   with a masculine and a feminine label so that the UI agrees with the entity ("torneo concluso", "partita
--   conclusa"). Read-only reference data, like point_types.
-- * Replaces the text columns tournaments.status and matches.status with status_id (FK to statuses); a match can only
--   be In corso or Conclusa. Existing values are converted: 'upcoming' -> 1, 'in-progress' -> 2, 'completed' -> 3.
-- * Converts the record copies kept for synchronization (sync_changes, sync_entity_snapshots), so that devices
--   downloading them later receive status_id too.
--
-- Deploy the app version with statuses right after running it: older app versions still send the text status, which
-- the database no longer accepts. Idempotent: it can be run again.

begin;

create table if not exists public.statuses (
  id smallint primary key,
  code text not null unique,
  label_masculine text not null,
  label_feminine text not null,
  applies_to_tournaments boolean not null,
  applies_to_matches boolean not null,
  sort_order smallint not null unique
);

insert into public.statuses (id, code, label_masculine, label_feminine, applies_to_tournaments, applies_to_matches, sort_order) values
  (1, 'upcoming', 'In programma', 'In programma', true, false, 1),
  (2, 'in_progress', 'In corso', 'In corso', true, true, 2),
  (3, 'completed', 'Concluso', 'Conclusa', true, true, 3)
on conflict (id) do update set
  code = excluded.code, label_masculine = excluded.label_masculine, label_feminine = excluded.label_feminine,
  applies_to_tournaments = excluded.applies_to_tournaments, applies_to_matches = excluded.applies_to_matches,
  sort_order = excluded.sort_order;

revoke all on table public.statuses from public, anon;
grant select on table public.statuses to authenticated;
alter table public.statuses enable row level security;
drop policy if exists "authenticated users can read statuses" on public.statuses;
create policy "authenticated users can read statuses"
  on public.statuses for select to authenticated
  using (true);

-- Tournaments: status -> status_id (In programma by default).
alter table public.tournaments add column if not exists status_id smallint;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tournaments' and column_name = 'status'
  ) then
    update public.tournaments
    set status_id = case status when 'in-progress' then 2 when 'completed' then 3 else 1 end
    where status_id is null;
  end if;
end
$$;
update public.tournaments set status_id = 1 where status_id is null;
alter table public.tournaments
  alter column status_id set default 1,
  alter column status_id set not null;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'tournaments_status_id_fkey' and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_status_id_fkey foreign key (status_id) references public.statuses(id);
  end if;
end
$$;
-- Dropping the column also drops its check (tournaments_status_check).
alter table public.tournaments drop column if exists status;

-- Matches: status -> status_id (In corso or Conclusa).
alter table public.matches add column if not exists status_id smallint;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matches' and column_name = 'status'
  ) then
    update public.matches
    set status_id = case status when 'completed' then 3 else 2 end
    where status_id is null;
  end if;
end
$$;
update public.matches set status_id = 2 where status_id is null;
alter table public.matches alter column status_id set not null;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'matches_status_id_fkey' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_status_id_fkey foreign key (status_id) references public.statuses(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'matches_status_id_check' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches add constraint matches_status_id_check check (status_id in (2, 3));
  end if;
end
$$;
alter table public.matches drop column if exists status;

-- Synchronization copies of tournaments and matches: the same conversion on their JSON payloads.
update public.sync_changes
set payload = (payload - 'status') || jsonb_build_object('status_id',
  case payload ->> 'status' when 'in-progress' then 2 when 'completed' then 3 else 1 end)
where entity_type = 'tournaments' and not (payload ? 'status_id');
update public.sync_changes
set payload = (payload - 'status') || jsonb_build_object('status_id',
  case payload ->> 'status' when 'completed' then 3 else 2 end)
where entity_type = 'matches' and not (payload ? 'status_id');
update public.sync_entity_snapshots
set payload = (payload - 'status') || jsonb_build_object('status_id',
  case payload ->> 'status' when 'in-progress' then 2 when 'completed' then 3 else 1 end)
where entity_type = 'tournaments' and not (payload ? 'status_id');
update public.sync_entity_snapshots
set payload = (payload - 'status') || jsonb_build_object('status_id',
  case payload ->> 'status' when 'completed' then 3 else 2 end)
where entity_type = 'matches' and not (payload ? 'status_id');

commit;

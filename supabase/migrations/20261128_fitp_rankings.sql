-- Incremental migration: FITP rankings registry. New databases get the same result directly from
-- supabase/initial_schema.sql.
--
-- * Adds public.fitp_rankings: the 20 FITP individual rankings from 4.NC to 2.1 (Quarta, Terza and Seconda categoria),
--   source Tabella 1 of the FITP "Metodo per la compilazione delle classifiche federali" 2026 and 2027. Read-only
--   reference data, like statuses.
-- * Replaces the free-text players.ranking with ranking_id (nullable FK to fitp_rankings). Existing texts are converted
--   with the rules of legacyFitpRankingId (src/features/players/fitpRankings.ts): spaces ignored, case and decimal comma
--   tolerated, 'NC' / 'N.C.' / '4NC' -> 4.NC. Texts that match no ranking become null (shown as "Non indicata").
-- * Converts the player copies kept for synchronization (sync_changes, sync_entity_snapshots), so that devices
--   downloading them later receive ranking_id too.
-- * matches.player_ranking_snapshot is NOT touched: it keeps the ranking each match was played with.
--
-- Deploy the app version with the rankings registry right after running it: older app versions send the text ranking,
-- which the database ignores (the player is saved without ranking). Idempotent: it can be run again.

begin;

-- FITP individual rankings (Quarta, Terza and Seconda categoria; Prima categoria and professionals not included yet).
-- Reference data (not synced): ids are stable and mirrored by the app (src/features/players/fitpRankings.ts) and by the
-- Dexie fitp_rankings store: never renumber them. Source: Tabella 1 of the FITP "Metodo per la compilazione delle
-- classifiche federali" 2026 and 2027. sort_order goes from the lowest ranking (4.NC) to the highest (2.1). A future
-- change of the classification adds rows (new ids) for its season and deactivates the old ones.
create table if not exists public.fitp_rankings (
  id smallint primary key,
  code text not null,
  name text not null,
  category_group text not null check (category_group in ('fourth', 'third', 'second')),
  sort_order smallint not null,
  is_active boolean not null default true,
  season smallint not null,
  unique (season, code),
  unique (season, sort_order)
);

insert into public.fitp_rankings (id, code, name, category_group, sort_order, is_active, season) values
  (1, '4.NC', 'IV categoria NC (non classificato)', 'fourth', 1, true, 2026),
  (2, '4.6', 'IV categoria 6° gruppo', 'fourth', 2, true, 2026),
  (3, '4.5', 'IV categoria 5° gruppo', 'fourth', 3, true, 2026),
  (4, '4.4', 'IV categoria 4° gruppo', 'fourth', 4, true, 2026),
  (5, '4.3', 'IV categoria 3° gruppo', 'fourth', 5, true, 2026),
  (6, '4.2', 'IV categoria 2° gruppo', 'fourth', 6, true, 2026),
  (7, '4.1', 'IV categoria 1° gruppo', 'fourth', 7, true, 2026),
  (8, '3.5', 'III categoria 5° gruppo', 'third', 8, true, 2026),
  (9, '3.4', 'III categoria 4° gruppo', 'third', 9, true, 2026),
  (10, '3.3', 'III categoria 3° gruppo', 'third', 10, true, 2026),
  (11, '3.2', 'III categoria 2° gruppo', 'third', 11, true, 2026),
  (12, '3.1', 'III categoria 1° gruppo', 'third', 12, true, 2026),
  (13, '2.8', 'II categoria 8° gruppo', 'second', 13, true, 2026),
  (14, '2.7', 'II categoria 7° gruppo', 'second', 14, true, 2026),
  (15, '2.6', 'II categoria 6° gruppo', 'second', 15, true, 2026),
  (16, '2.5', 'II categoria 5° gruppo', 'second', 16, true, 2026),
  (17, '2.4', 'II categoria 4° gruppo', 'second', 17, true, 2026),
  (18, '2.3', 'II categoria 3° gruppo', 'second', 18, true, 2026),
  (19, '2.2', 'II categoria 2° gruppo', 'second', 19, true, 2026),
  (20, '2.1', 'II categoria 1° gruppo', 'second', 20, true, 2026)
on conflict (id) do update set
  code = excluded.code, name = excluded.name, category_group = excluded.category_group,
  sort_order = excluded.sort_order, is_active = excluded.is_active, season = excluded.season;

revoke all on table public.fitp_rankings from public, anon;
grant select on table public.fitp_rankings to authenticated;
alter table public.fitp_rankings enable row level security;
drop policy if exists "authenticated users can read fitp rankings" on public.fitp_rankings;
create policy "authenticated users can read fitp rankings"
  on public.fitp_rankings for select to authenticated
  using (true);

-- Registry id of a free-text ranking (null when it matches no code). Temporary: dropped at the end of the session.
create or replace function pg_temp.legacy_fitp_ranking_id(_ranking text)
returns smallint
language sql
stable
as $$
  select r.id
  from public.fitp_rankings r
  where r.code = (
    select case when normalized in ('NC', 'N.C.', 'N.C', '4NC', '4.N.C.', '4.N.C') then '4.NC' else normalized end
    from (select upper(replace(regexp_replace(coalesce(_ranking, ''), '\s', '', 'g'), ',', '.')) as normalized) n
  )
  order by r.season desc
  limit 1
$$;

-- Players: ranking -> ranking_id.
alter table public.players add column if not exists ranking_id smallint;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'players_ranking_id_fkey' and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_ranking_id_fkey foreign key (ranking_id) references public.fitp_rankings(id);
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'ranking'
  ) then
    -- Plain data conversion: version and updated_at are left unchanged, as for the statuses migration.
    execute 'update public.players set ranking_id = pg_temp.legacy_fitp_ranking_id(ranking) where ranking_id is null';
  end if;
end
$$;
alter table public.players drop column if exists ranking;

-- Synchronization copies of players: the same conversion on their JSON payloads.
update public.sync_changes
set payload = (payload - 'ranking') || jsonb_build_object('ranking_id', pg_temp.legacy_fitp_ranking_id(payload ->> 'ranking'))
where entity_type = 'players' and not (payload ? 'ranking_id');
update public.sync_entity_snapshots
set payload = (payload - 'ranking') || jsonb_build_object('ranking_id', pg_temp.legacy_fitp_ranking_id(payload ->> 'ranking'))
where entity_type = 'players' and not (payload ? 'ranking_id');

drop function pg_temp.legacy_fitp_ranking_id(text);

commit;

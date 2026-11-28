-- Incremental migration: match ranking snapshots as foreign keys to the FITP rankings registry.
-- Run it after 20261128_fitp_rankings.sql. New databases get the same result directly from supabase/initial_schema.sql.
--
-- * matches.player_ranking_snapshot: text (ranking code) -> smallint FK to fitp_rankings (null = not specified).
-- * matches.opponent_ranking (free text) is renamed opponent_ranking_snapshot and becomes a smallint FK to
--   fitp_rankings as well.
-- * Existing texts are converted with the rules of legacyFitpRankingId (src/features/players/fitpRankings.ts): spaces
--   ignored, case and decimal comma tolerated, 'NC' / 'N.C.' / '4NC' -> 4.NC. Texts that match no ranking become null.
-- * Converts the match copies kept for synchronization (sync_changes, sync_entity_snapshots), so that devices
--   downloading them later receive the ids too.
--
-- Deploy the matching app version right after running it: older app versions send ranking codes as text, which the
-- database no longer accepts for matches. Idempotent: it can be run again.

begin;

-- The matches foreign keys are deferrable: checked immediately, the data updates below leave no pending trigger events,
-- which would make the following ALTER TABLE fail.
set constraints all immediate;

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

do $$
begin
  -- Player snapshot: text code -> fitp_rankings id.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matches' and column_name = 'player_ranking_snapshot'
      and data_type = 'text'
  ) then
    alter table public.matches alter column player_ranking_snapshot drop default;
    alter table public.matches alter column player_ranking_snapshot drop not null;
    alter table public.matches
      alter column player_ranking_snapshot type smallint using pg_temp.legacy_fitp_ranking_id(player_ranking_snapshot);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'matches_player_ranking_snapshot_fkey' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches add constraint matches_player_ranking_snapshot_fkey
      foreign key (player_ranking_snapshot) references public.fitp_rankings(id);
  end if;

  -- Opponent snapshot: free-text opponent_ranking -> opponent_ranking_snapshot (fitp_rankings id).
  alter table public.matches add column if not exists opponent_ranking_snapshot smallint;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'matches_opponent_ranking_snapshot_fkey' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches add constraint matches_opponent_ranking_snapshot_fkey
      foreign key (opponent_ranking_snapshot) references public.fitp_rankings(id);
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matches' and column_name = 'opponent_ranking'
  ) then
    -- Plain data conversion: version and updated_at are left unchanged, as for the statuses migration.
    execute 'update public.matches set opponent_ranking_snapshot = pg_temp.legacy_fitp_ranking_id(opponent_ranking)
      where opponent_ranking_snapshot is null';
    alter table public.matches drop column opponent_ranking;
  end if;
end
$$;

-- Synchronization copies of matches: the same conversion on their JSON payloads.
update public.sync_changes
set payload = payload || jsonb_build_object('player_ranking_snapshot',
  pg_temp.legacy_fitp_ranking_id(payload ->> 'player_ranking_snapshot'))
where entity_type = 'matches' and jsonb_typeof(payload -> 'player_ranking_snapshot') = 'string';
update public.sync_changes
set payload = (payload - 'opponent_ranking') || jsonb_build_object('opponent_ranking_snapshot',
  pg_temp.legacy_fitp_ranking_id(payload ->> 'opponent_ranking'))
where entity_type = 'matches' and payload ? 'opponent_ranking';
update public.sync_entity_snapshots
set payload = payload || jsonb_build_object('player_ranking_snapshot',
  pg_temp.legacy_fitp_ranking_id(payload ->> 'player_ranking_snapshot'))
where entity_type = 'matches' and jsonb_typeof(payload -> 'player_ranking_snapshot') = 'string';
update public.sync_entity_snapshots
set payload = (payload - 'opponent_ranking') || jsonb_build_object('opponent_ranking_snapshot',
  pg_temp.legacy_fitp_ranking_id(payload ->> 'opponent_ranking'))
where entity_type = 'matches' and payload ? 'opponent_ranking';

drop function pg_temp.legacy_fitp_ranking_id(text);

commit;

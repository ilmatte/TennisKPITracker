-- Incremental migration: sets.status_id, FK to the statuses registry (1 In programma, 2 In corso, 3 Concluso).
-- Run it after the apply_sync_record fix that writes only the columns present in the payload (app versions that do not
-- send status_id then keep the stored value instead of failing). New databases get the same result directly from
-- supabase/initial_schema.sql.
--
-- * Existing sets are backfilled with the rules of setStatusId (src/features/scoring/scoring.ts): Concluso when the
--   stored games meet the match's set rules, In corso when the set has at least one point, otherwise In programma.
-- * The set copies kept for synchronization (sync_changes, sync_entity_snapshots) get the status of the current row,
--   so that devices downloading them later receive it too.
-- * Plain data conversion: version and updated_at are left unchanged, as for the previous migrations.
-- Idempotent: it can be run again.

begin;

alter table public.sets add column if not exists status_id smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'sets_status_id_fkey' and conrelid = 'public.sets'::regclass
  ) then
    alter table public.sets add constraint sets_status_id_fkey foreign key (status_id) references public.statuses(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'sets_status_id_check' and conrelid = 'public.sets'::regclass
  ) then
    alter table public.sets add constraint sets_status_id_check check (status_id in (1, 2, 3));
  end if;
end
$$;

update public.sets s
set status_id = case
  -- Concluso: a deciding super tie-break is won 1-0; a normal set by games_to_win_set with two games of margin, or
  -- after the tie-break (tiebreak_at + 1 to tiebreak_at).
  when case
    when m.number_of_sets = 3 and m.last_set_type = 'super-tiebreak' and s.set_number = 3
      then greatest(s.player_games, s.opponent_games) >= 1
    else (greatest(s.player_games, s.opponent_games) >= m.games_to_win_set
        and greatest(s.player_games, s.opponent_games) - least(s.player_games, s.opponent_games) >= 2)
      or (greatest(s.player_games, s.opponent_games) = tb.tiebreak_at + 1
        and least(s.player_games, s.opponent_games) = tb.tiebreak_at)
  end then 3
  -- In corso: at least one point recorded in the set.
  when exists (
    select 1 from public.games g join public.points p on p.game_id = g.id and p.family_id = g.family_id
    where g.set_id = s.id and g.family_id = s.family_id and not g.deleted and not p.deleted
  ) then 2
  else 1
end
from public.matches m
cross join lateral (
  select case when m.games_to_win_set = 4 then m.short_set_tiebreak_at else 6 end as tiebreak_at
) tb
where m.id = s.match_id and m.family_id = s.family_id;

-- Synchronization copies of sets: the status of the current row.
update public.sync_changes copy
set payload = copy.payload || jsonb_build_object('status_id', s.status_id)
from public.sets s
where copy.entity_type = 'sets' and s.id = copy.entity_id and s.family_id = copy.family_id
  and not copy.payload ? 'status_id';
update public.sync_entity_snapshots copy
set payload = copy.payload || jsonb_build_object('status_id', s.status_id)
from public.sets s
where copy.entity_type = 'sets' and s.id = copy.entity_id and s.family_id = copy.family_id
  and not copy.payload ? 'status_id';

commit;

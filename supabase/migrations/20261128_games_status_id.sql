-- Incremental migration: games.status_id, FK to the statuses registry (1 In programma, 2 In corso, 3 Concluso).
-- Run it after the apply_sync_record fix that writes only the columns present in the payload (app versions that do not
-- send status_id then keep the stored value instead of failing). New databases get the same result directly from
-- supabase/initial_schema.sql.
--
-- * Existing games are backfilled with the rules of gameStatusId (src/features/scoring/scoring.ts), applied to the
--   stored player_points / opponent_points (the count of the game's active points):
--   - the game is a tie-break when it is game tiebreak_at * 2 + 1 of its set (it exists only after tiebreak_at all),
--     a super tie-break when it is game 1 of a deciding super tie-break set; its target is tiebreak_target, or
--     super_tiebreak_target for the super tie-break and for the tie-break of the fifth set with last_set_type
--     'super-tiebreak'. A tie-break is won at the target with two points of margin;
--   - a normal game is won at 4 points: with deuce_single_point by any margin, otherwise with two points of margin;
--   - otherwise In corso with at least one point, In programma without.
-- * The game copies kept for synchronization (sync_changes, sync_entity_snapshots) get the status of the current row,
--   so that devices downloading them later receive it too.
-- * Plain data conversion: version and updated_at are left unchanged, as for the previous migrations.
-- Idempotent: it can be run again.

begin;

alter table public.games add column if not exists status_id smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'games_status_id_fkey' and conrelid = 'public.games'::regclass
  ) then
    alter table public.games add constraint games_status_id_fkey foreign key (status_id) references public.statuses(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'games_status_id_check' and conrelid = 'public.games'::regclass
  ) then
    alter table public.games add constraint games_status_id_check check (status_id in (1, 2, 3));
  end if;
end
$$;

-- Tie-break target of each game (null for a normal game). Computed in a CTE: the table being updated cannot be
-- referenced from a lateral subquery of the UPDATE's FROM clause.
with rule as (
  select
    g.id,
    m.deuce_single_point,
    case
      when m.number_of_sets = 3 and m.last_set_type = 'super-tiebreak' and s.set_number = 3
        then case when g.game_number = 1 then coalesce(nullif(m.super_tiebreak_target, 0), 10) end
      when g.game_number = (case when m.games_to_win_set = 4 then m.short_set_tiebreak_at else 6 end) * 2 + 1
        then case when m.number_of_sets = 5 and m.last_set_type = 'super-tiebreak' and s.set_number = 5
          then coalesce(nullif(m.super_tiebreak_target, 0), 10)
          else coalesce(nullif(m.tiebreak_target, 0), 7) end
    end as target
  from public.games g
  join public.sets s on s.id = g.set_id and s.family_id = g.family_id
  join public.matches m on m.id = s.match_id and m.family_id = s.family_id
)
update public.games g
set status_id = case
  when case
    when rule.target is not null
      then greatest(g.player_points, g.opponent_points) >= rule.target
        and abs(g.player_points - g.opponent_points) >= 2
    when rule.deuce_single_point
      then greatest(g.player_points, g.opponent_points) >= 4 and g.player_points <> g.opponent_points
    else greatest(g.player_points, g.opponent_points) >= 4 and abs(g.player_points - g.opponent_points) >= 2
  end then 3
  when g.player_points + g.opponent_points > 0 then 2
  else 1
end
from rule
where rule.id = g.id;

-- Synchronization copies of games: the status of the current row.
update public.sync_changes copy
set payload = copy.payload || jsonb_build_object('status_id', g.status_id)
from public.games g
where copy.entity_type = 'games' and g.id = copy.entity_id and g.family_id = copy.family_id
  and not copy.payload ? 'status_id';
update public.sync_entity_snapshots copy
set payload = copy.payload || jsonb_build_object('status_id', g.status_id)
from public.games g
where copy.entity_type = 'games' and g.id = copy.entity_id and g.family_id = copy.family_id
  and not copy.payload ? 'status_id';

commit;

-- Add explicit set-length and short-set tie-break threshold options.
-- Existing records retain the behavior selected by the legacy boolean.
alter table public.matches
  add column if not exists games_to_win_set integer,
  add column if not exists short_set_tiebreak_at integer;

update public.matches
set games_to_win_set = case when tiebreak_starts_at_363 then 4 else 6 end,
    short_set_tiebreak_at = 3
where games_to_win_set is null or short_set_tiebreak_at is null;

alter table public.matches
  alter column games_to_win_set set default 4,
  alter column games_to_win_set set not null,
  alter column short_set_tiebreak_at set default 3,
  alter column short_set_tiebreak_at set not null;

alter table public.matches
  drop constraint if exists matches_games_to_win_set_check,
  add constraint matches_games_to_win_set_check check (games_to_win_set in (4, 6)),
  drop constraint if exists matches_short_set_tiebreak_at_check,
  add constraint matches_short_set_tiebreak_at_check check (short_set_tiebreak_at in (3, 4));

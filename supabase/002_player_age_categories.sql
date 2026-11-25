-- Adds the player_age_categories reference table to a Supabase project created before it existed.
-- New projects get it from initial_schema.sql. Idempotent: safe to run more than once.

begin;

-- FITP age categories of players. Reference data (not synced): ids are stable and mirrored by the app
-- (src/features/players/ageCategories.ts) and by the Dexie player_age_categories store: never renumber them.
-- The category is computed from players.birth_date for a sporting year; it is independent from players.ranking
-- (FITP technical ranking). min_age is inclusive, max_age exclusive (null = no upper limit).
-- age_basis: 'january_1' = years completed on 1 January of the sporting year (youth sectors, Open);
--            'calendar_year' = age reached during the sporting year (veterans).
create table if not exists public.player_age_categories (
  id smallint primary key,
  code text not null unique,
  name text not null,
  sector text not null check (sector in ('youth', 'open', 'veterans')),
  sort_order smallint not null unique,
  is_active boolean not null default true,
  min_age smallint not null check (min_age >= 0),
  max_age smallint check (max_age is null or max_age > min_age),
  age_basis text not null check (age_basis in ('january_1', 'calendar_year'))
);

-- Idempotent seed: re-running it updates the rows instead of duplicating them.
insert into public.player_age_categories (id, code, name, sector, sort_order, is_active, min_age, max_age, age_basis) values
  (1, 'U12', 'Under 12', 'youth', 1, true, 10, 12, 'january_1'),
  (2, 'U14', 'Under 14', 'youth', 2, true, 12, 14, 'january_1'),
  (3, 'U16', 'Under 16', 'youth', 3, true, 14, 16, 'january_1'),
  (4, 'U18', 'Under 18', 'youth', 4, true, 16, 18, 'january_1'),
  (5, 'OPEN', 'Open', 'open', 5, true, 18, null, 'january_1'),
  (6, 'O30', 'Over 30', 'veterans', 6, false, 30, 35, 'calendar_year'),
  (7, 'O35', 'Over 35', 'veterans', 7, false, 35, 40, 'calendar_year'),
  (8, 'O40', 'Over 40', 'veterans', 8, false, 40, 45, 'calendar_year'),
  (9, 'O45', 'Over 45', 'veterans', 9, false, 45, 50, 'calendar_year'),
  (10, 'O50', 'Over 50', 'veterans', 10, false, 50, 55, 'calendar_year'),
  (11, 'O55', 'Over 55', 'veterans', 11, false, 55, 60, 'calendar_year'),
  (12, 'O60', 'Over 60', 'veterans', 12, false, 60, 65, 'calendar_year'),
  (13, 'O65', 'Over 65', 'veterans', 13, false, 65, 70, 'calendar_year'),
  (14, 'O70', 'Over 70', 'veterans', 14, false, 70, 75, 'calendar_year'),
  (15, 'O75', 'Over 75', 'veterans', 15, false, 75, 80, 'calendar_year'),
  (16, 'O80', 'Over 80', 'veterans', 16, false, 80, null, 'calendar_year')
on conflict (id) do update set
  code = excluded.code, name = excluded.name, sector = excluded.sector, sort_order = excluded.sort_order,
  is_active = excluded.is_active, min_age = excluded.min_age, max_age = excluded.max_age, age_basis = excluded.age_basis;

revoke all on table public.player_age_categories from public, anon;
grant select on table public.player_age_categories to authenticated;
alter table public.player_age_categories enable row level security;
drop policy if exists "authenticated users can read player age categories" on public.player_age_categories;
create policy "authenticated users can read player age categories"
  on public.player_age_categories for select to authenticated
  using (true);

commit;

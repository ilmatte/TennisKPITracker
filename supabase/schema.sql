create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  birth_date date,
  category text,
  ranking text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted boolean not null default false,
  unique(user_id,id)
);

create table if not exists public.matches (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_date date not null,
  player_id uuid,
  player_first_name_snapshot text not null,
  player_last_name_snapshot text not null default '',
  player_ranking_snapshot text,
  player_category_snapshot text,
  opponent text not null,
  opponent_ranking text,
  opponent_category text,
  tournament text,
  tournament_match_number integer,
  number_of_sets integer not null,
  third_set_type text not null,
  super_tiebreak_target integer not null default 10,
  tiebreak_target integer not null default 10,
  tiebreak_starts_at_363 boolean not null default true,
  deuce_single_point boolean not null default true,
  first_server text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted boolean not null default false,
  unique(user_id,id)
);

create table if not exists public.points (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  set_number integer not null,
  game_number integer not null,
  point_number integer not null,
  winner text not null,
  server text not null,
  second_serve boolean not null default false,
  double_fault boolean not null default false,
  shot_count integer not null,
  free_error boolean not null default false,
  error_player text,
  error_category text,
  attack_error boolean not null default false,
  pressure_situation boolean not null default false,
  pressure_error_player text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted boolean not null default false,
  unique(user_id,id)
);

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.points enable row level security;

create policy "own players" on public.players for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own matches" on public.matches for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own points" on public.points for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

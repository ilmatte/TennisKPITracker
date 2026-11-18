begin;

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_id uuid not null,
  set_number integer not null check (set_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(match_id, set_number),
  unique(user_id, id),
  foreign key (user_id, match_id) references public.matches(user_id, id) on delete cascade
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  set_id uuid not null,
  game_number integer not null check (game_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(set_id, game_number),
  unique(user_id, id),
  foreign key (user_id, set_id) references public.sets(user_id, id) on delete cascade
);

create index sets_match_id_idx on public.sets(match_id);
create index games_set_id_idx on public.games(set_id);

alter table public.points add column game_id uuid;

insert into public.sets (user_id, match_id, set_number)
select distinct p.user_id, p.match_id, p.set_number
from public.points p
on conflict (match_id, set_number) do nothing;

insert into public.games (user_id, set_id, game_number)
select distinct p.user_id, s.id, p.game_number
from public.points p
join public.sets s
  on s.user_id = p.user_id
 and s.match_id = p.match_id
 and s.set_number = p.set_number
on conflict (set_id, game_number) do nothing;

update public.points p
set game_id = g.id
from public.sets s
join public.games g
  on g.user_id = s.user_id
 and g.set_id = s.id
where s.user_id = p.user_id
  and s.match_id = p.match_id
  and s.set_number = p.set_number
  and g.game_number = p.game_number;

alter table public.points alter column game_id set not null;
alter table public.points
  add constraint points_user_game_id_fkey
  foreign key (user_id, game_id) references public.games(user_id, id) on delete cascade;

alter table public.points
  drop column match_id,
  drop column set_number,
  drop column game_number;

create index points_game_id_idx on public.points(game_id);

alter table public.sets enable row level security;
alter table public.games enable row level security;

create policy "own sets" on public.sets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own games" on public.games for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;

begin;

create schema if not exists extensions;
create schema if not exists private;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pgcrypto'
  ) then
    execute 'create extension pgcrypto with schema extensions';
  end if;
end;
$$;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  unique (id, created_by)
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_email text not null,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

alter table public.families
  add constraint families_creator_is_owner_fkey
  foreign key (id, created_by) references public.family_members(family_id, user_id)
  deferrable initially deferred;

create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  invited_email text not null check (invited_email = lower(btrim(invited_email))),
  invited_by uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (family_id, invited_by) references public.family_members(family_id, user_id) on delete cascade,
  check (expires_at > created_at)
);

create table public.players (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  birth_date date,
  category text not null default '',
  ranking text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id)
);

create table public.matches (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  match_date date not null,
  player_id uuid not null,
  player_first_name_snapshot text not null,
  player_last_name_snapshot text not null default '',
  player_ranking_snapshot text not null default '',
  player_category_snapshot text not null default '',
  opponent text not null,
  opponent_ranking text,
  opponent_category text,
  tournament text,
  tournament_match_number integer,
  number_of_sets integer not null check (number_of_sets in (3, 5)),
  third_set_type text not null check (third_set_type in ('normal', 'super-tiebreak')),
  super_tiebreak_target integer not null default 10 check (super_tiebreak_target > 0),
  tiebreak_target integer not null default 7 check (tiebreak_target > 0),
  tiebreak_starts_at_363 boolean not null default true,
  deuce_single_point boolean not null default true,
  first_server text not null check (first_server in ('player', 'opponent')),
  status text not null check (status in ('in-progress', 'completed')),
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id),
  foreign key (family_id, player_id)
    references public.players(family_id, id)
    on delete no action
    deferrable initially deferred
);

create table public.sets (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  match_id uuid not null,
  set_number integer not null check (set_number > 0),
  player_games integer not null default 0 check (player_games >= 0),
  opponent_games integer not null default 0 check (opponent_games >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id),
  unique (match_id, set_number),
  foreign key (family_id, match_id) references public.matches(family_id, id) on delete cascade
);

create table public.games (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  set_id uuid not null,
  game_number integer not null check (game_number > 0),
  player_points integer not null default 0 check (player_points >= 0),
  opponent_points integer not null default 0 check (opponent_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id),
  unique (set_id, game_number),
  foreign key (family_id, set_id) references public.sets(family_id, id) on delete cascade
);

create table public.points (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  game_id uuid not null,
  point_number integer not null check (point_number > 0),
  winner text not null check (winner in ('player', 'opponent')),
  server text not null check (server in ('player', 'opponent')),
  second_serve boolean not null default false,
  double_fault boolean not null default false,
  shot_count integer not null check (shot_count > 0),
  free_error boolean not null default false,
  error_player text check (error_player in ('player', 'opponent')),
  error_category text check (error_category in ('forehand', 'backhand', 'serve', 'volley', 'net', 'other')),
  attack_error boolean not null default false,
  pressure_situation boolean not null default false,
  pressure_error_player text check (pressure_error_player in ('player', 'opponent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id),
  unique (game_id, point_number),
  foreign key (family_id, game_id) references public.games(family_id, id) on delete cascade
);

create index family_members_user_id_idx on public.family_members(user_id, family_id);
create index family_invitations_family_id_idx on public.family_invitations(family_id, created_at desc);
create index players_family_id_idx on public.players(family_id, updated_at desc);
create index matches_family_date_idx on public.matches(family_id, match_date desc);
create index matches_family_player_idx on public.matches(family_id, player_id);
create index sets_family_match_idx on public.sets(family_id, match_id, set_number);
create index games_family_set_idx on public.games(family_id, set_id, game_number);
create index points_family_game_idx on public.points(family_id, game_id, point_number);

create function private.is_family_member(_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = _family_id
      and fm.user_id = (select auth.uid())
  );
$$;

create function private.is_family_owner(_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = _family_id
      and fm.user_id = (select auth.uid())
      and fm.role = 'owner'
  );
$$;

create function public.create_family(_id uuid, _name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_family_id uuid := _id;
  owner_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if new_family_id is null or _name is null or length(btrim(_name)) = 0 then
    raise exception 'Family name is required';
  end if;

  select lower(u.email) into owner_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if owner_email is null then
    raise exception 'A confirmed email address is required';
  end if;

  insert into public.families (id, name, created_by)
  values (new_family_id, btrim(_name), auth.uid());
  insert into public.family_members (family_id, user_id, member_email, role)
  values (new_family_id, auth.uid(), owner_email, 'owner');
  return new_family_id;
end;
$$;

create function public.create_family_invitation(_id uuid, _family_id uuid, _invited_email text)
returns table (invitation_id uuid, token text, expires_at timestamptz, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(_invited_email));
  pgcrypto_schema name;
  raw_token text;
  raw_token_hash text;
  new_invitation_id uuid := _id;
  expiry timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or not private.is_family_owner(_family_id) then
    raise exception 'Only the family owner can invite members';
  end if;
  if new_invitation_id is null then
    raise exception 'Invitation ID is required';
  end if;
  if normalized_email is null or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'A valid email address is required';
  end if;
  if exists (
    select 1 from public.family_members fm
    where fm.family_id = _family_id and lower(fm.member_email) = normalized_email
  ) then
    raise exception 'This email already belongs to the family';
  end if;

  select n.nspname into pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if pgcrypto_schema is null then
    raise exception 'pgcrypto is not installed';
  end if;
  execute format('select encode(%I.gen_random_bytes(32), %L)', pgcrypto_schema, 'hex')
    into raw_token;
  execute format(
    'select encode(%I.digest(convert_to(%L, %L), %L), %L)',
    pgcrypto_schema, raw_token, 'UTF8', 'sha256', 'hex'
  ) into raw_token_hash;

  insert into public.family_invitations (
    id, family_id, invited_email, invited_by, token_hash, expires_at
  )
  values (
    new_invitation_id, _family_id, normalized_email, auth.uid(),
    raw_token_hash, expiry
  );
  return query select new_invitation_id, raw_token, expiry, now();
end;
$$;

create function public.accept_family_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_email text;
  pgcrypto_schema name;
  computed_token_hash text;
  invitation public.family_invitations%rowtype;
begin
  if auth.uid() is null or _token is null or _token !~ '^[0-9a-f]{64}$' then
    raise exception 'Authentication and a valid invitation are required';
  end if;

  select lower(u.email) into current_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if current_email is null then
    raise exception 'A confirmed email address is required';
  end if;

  select n.nspname into pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if pgcrypto_schema is null then
    raise exception 'pgcrypto is not installed';
  end if;
  execute format(
    'select encode(%I.digest(convert_to(%L, %L), %L), %L)',
    pgcrypto_schema, _token, 'UTF8', 'sha256', 'hex'
  ) into computed_token_hash;

  select fi.* into invitation
  from public.family_invitations fi
  where fi.token_hash = computed_token_hash
  for update;
  if not found or invitation.accepted_at is not null or invitation.expires_at <= now() then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;
  if invitation.invited_email <> current_email then
    raise exception 'Invitation email does not match the authenticated account';
  end if;
  if exists (
    select 1 from public.family_members fm
    where fm.family_id = invitation.family_id and fm.user_id = auth.uid()
  ) then
    raise exception 'This account is already a family member';
  end if;

  insert into public.family_members (family_id, user_id, member_email, role)
  values (invitation.family_id, auth.uid(), current_email, 'member');
  update public.family_invitations
  set accepted_at = now()
  where id = invitation.id and accepted_at is null;
  return invitation.family_id;
end;
$$;

create function public.delete_family(_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.families f
  where f.id = _family_id
  for update;
  if not found then
    raise exception 'Family not found';
  end if;
  if not private.is_family_owner(_family_id) then
    raise exception 'Only the family owner can delete the family';
  end if;

  delete from public.family_members fm
  where fm.family_id = _family_id
    and fm.user_id = auth.uid()
    and fm.role = 'owner';
  if not found then
    raise exception 'Family owner membership not found';
  end if;

  delete from public.families f
  where f.id = _family_id;
  if not found then
    raise exception 'Family could not be deleted';
  end if;
end;
$$;

create function public.revoke_family_member(_family_id uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_family_owner(_family_id) then
    raise exception 'Only the family owner can revoke membership';
  end if;
  if _user_id = auth.uid() then
    raise exception 'The owner cannot revoke their own membership';
  end if;
  delete from public.family_members fm
  where fm.family_id = _family_id and fm.user_id = _user_id and fm.role = 'member';
  if not found then
    raise exception 'Family member not found';
  end if;
end;
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
grant usage on schema public to authenticated;
revoke all on function private.is_family_member(uuid) from public, anon;
revoke all on function private.is_family_owner(uuid) from public, anon;
revoke all on function public.create_family(uuid, text) from public, anon;
revoke all on function public.create_family_invitation(uuid, uuid, text) from public, anon;
revoke all on function public.accept_family_invitation(text) from public, anon;
revoke all on function public.delete_family(uuid) from public, anon;
revoke all on function public.revoke_family_member(uuid, uuid) from public, anon;
grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function private.is_family_owner(uuid) to authenticated;
grant execute on function public.create_family(uuid, text) to authenticated;
grant execute on function public.create_family_invitation(uuid, uuid, text) to authenticated;
grant execute on function public.accept_family_invitation(text) to authenticated;
grant execute on function public.delete_family(uuid) to authenticated;
grant execute on function public.revoke_family_member(uuid, uuid) to authenticated;

revoke all on table
  public.families,
  public.family_members,
  public.family_invitations,
  public.players,
  public.matches,
  public.sets,
  public.games,
  public.points
from public, anon, authenticated;

grant select on table public.families to authenticated;
grant select on table public.family_members to authenticated;
grant select, insert, update on table
  public.players,
  public.matches,
  public.sets,
  public.games,
  public.points
to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invitations enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.sets enable row level security;
alter table public.games enable row level security;
alter table public.points enable row level security;

create policy "family members can read their families"
  on public.families for select to authenticated
  using (private.is_family_member(id));
create policy "family members can read membership"
  on public.family_members for select to authenticated
  using (private.is_family_member(family_id));

create policy "family members can read players"
  on public.players for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert players"
  on public.players for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update players"
  on public.players for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "family members can read matches"
  on public.matches for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert matches"
  on public.matches for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update matches"
  on public.matches for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "family members can read sets"
  on public.sets for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert sets"
  on public.sets for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update sets"
  on public.sets for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "family members can read games"
  on public.games for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert games"
  on public.games for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update games"
  on public.games for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "family members can read points"
  on public.points for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert points"
  on public.points for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update points"
  on public.points for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

commit;

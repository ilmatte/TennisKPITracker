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

create unique index families_one_workspace_per_owner_idx
  on public.families(created_by);

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
  ranking text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id)
);

-- Clubs where the family plays. surface (optional): clay, hard, grass, synthetic, indoor.
create table public.clubs (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  city text not null default '',
  surface text check (surface in ('clay', 'hard', 'grass', 'synthetic', 'indoor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id)
);

-- Tournaments the family takes part in. club_id: hosting club. age_category_id: FK to player_age_categories (the
-- constraint is added after that table is created, at the end of this script); the app offers U12 to Open.
create table public.tournaments (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  club_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  age_category_id smallint not null,
  start_date date not null,
  -- 'upcoming' (In programma) when created; changed only by hand in the app.
  status text not null default 'upcoming'
    constraint tournaments_status_check check (status in ('upcoming', 'in-progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  unique (family_id, id),
  constraint tournaments_family_id_club_id_fkey foreign key (family_id, club_id)
    references public.clubs(family_id, id)
    on delete no action
    deferrable initially deferred
);

create table public.matches (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  match_date date not null,
  player_id uuid not null,
  player_ranking_snapshot text not null default '',
  opponent text not null,
  opponent_ranking text,
  tournament_match_number integer,
  number_of_sets integer not null check (number_of_sets in (3, 5)),
  third_set_type text not null check (third_set_type in ('normal', 'super-tiebreak')),
  super_tiebreak_target integer not null default 10 check (super_tiebreak_target > 0),
  tiebreak_target integer not null default 7 check (tiebreak_target > 0),
  games_to_win_set integer not null default 4 check (games_to_win_set in (4, 6)),
  short_set_tiebreak_at integer not null default 3 check (short_set_tiebreak_at in (3, 4)),
  tiebreak_starts_at_363 boolean not null default true,
  deuce_single_point boolean not null default true,
  first_server text not null check (first_server in ('player', 'opponent')),
  status text not null check (status in ('in-progress', 'completed')),
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  -- Tournament of the match; null only for matches created before tournaments existed.
  tournament_id uuid,
  unique (family_id, id),
  foreign key (family_id, player_id)
    references public.players(family_id, id)
    on delete no action
    deferrable initially deferred,
  constraint matches_family_id_tournament_id_fkey foreign key (family_id, tournament_id)
    references public.tournaments(family_id, id)
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

-- Point types lookup table. Ids are stable and mirrored by the app (src/features/scoring/pointTypes.ts) and by the
-- Dexie point_types store: never renumber them. Like points.won, every type refers to my player.
create table public.point_types (
  id smallint primary key,
  code text not null unique,
  label text not null
);

insert into public.point_types (id, code, label) values
  (1, 'double_fault', 'Doppio fallo'),
  (2, 'free_error', 'Errore gratuito'),
  (3, 'lose', 'Perso'),
  (4, 'win', 'Vinto'),
  (5, 'ace', 'Ace'),
  (6, 'great_shot', 'Bel colpo');

-- won: true when my player won the point. serving: true when my player served it.
-- point_type_id: outcome of the point from my player's point of view.
create table public.points (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  game_id uuid not null,
  point_number integer not null check (point_number > 0),
  second_serve boolean not null default false,
  shot_count integer not null check (shot_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  won boolean not null,
  serving boolean not null,
  point_type_id smallint not null references public.point_types(id),
  unique (family_id, id),
  unique (game_id, point_number),
  foreign key (family_id, game_id) references public.games(family_id, id) on delete cascade
);

create index family_members_user_id_idx on public.family_members(user_id, family_id);
create index family_invitations_family_id_idx on public.family_invitations(family_id, created_at desc);
create index players_family_id_idx on public.players(family_id, updated_at desc);
create index clubs_family_id_idx on public.clubs(family_id, updated_at desc);
create index tournaments_family_id_idx on public.tournaments(family_id, updated_at desc);
create index matches_family_date_idx on public.matches(family_id, match_date desc);
create index matches_family_player_idx on public.matches(family_id, player_id);
create index matches_family_tournament_idx on public.matches(family_id, tournament_id);
create index sets_family_match_idx on public.sets(family_id, match_id, set_number);
create index games_family_set_idx on public.games(family_id, set_id, game_number);
create index points_family_game_idx on public.points(family_id, game_id, point_number);
create index points_point_type_idx on public.points(point_type_id);

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
  existing_family_id uuid;
  owner_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );

  select f.id into existing_family_id
  from public.families f
  where f.created_by = auth.uid();
  if found then
    return existing_family_id;
  end if;

  if new_family_id is null or _name is null or length(btrim(_name)) = 0 then
    raise exception 'Family name is required';
  end if;

  if exists (
    select 1
    from public.family_members fm
    where fm.user_id = auth.uid()
      and fm.role = 'member'
  ) then
    raise exception 'A family member cannot create an owner workspace';
  end if;

  select lower(u.email) into owner_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if owner_email is null then
    raise exception 'A confirmed email address is required';
  end if;

  insert into public.families (id, name, created_by)
  values (new_family_id, btrim(_name), auth.uid())
  on conflict (created_by) do nothing
  returning id into existing_family_id;

  if existing_family_id is null then
    select f.id into existing_family_id
    from public.families f
    where f.created_by = auth.uid();
    return existing_family_id;
  end if;

  insert into public.family_members (family_id, user_id, member_email, role)
  values (existing_family_id, auth.uid(), owner_email, 'owner');
  return existing_family_id;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );

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
  public.clubs,
  public.tournaments,
  public.matches,
  public.sets,
  public.games,
  public.points
from public, anon, authenticated;

grant select on table public.families to authenticated;
grant select on table public.family_members to authenticated;
grant select, insert, update on table
  public.players,
  public.clubs,
  public.tournaments,
  public.matches,
  public.sets,
  public.games,
  public.points
to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invitations enable row level security;
alter table public.players enable row level security;
alter table public.clubs enable row level security;
alter table public.tournaments enable row level security;
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

create policy "family members can read clubs"
  on public.clubs for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert clubs"
  on public.clubs for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update clubs"
  on public.clubs for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "family members can read tournaments"
  on public.tournaments for select to authenticated
  using (private.is_family_member(family_id));
create policy "family members can insert tournaments"
  on public.tournaments for insert to authenticated
  with check (private.is_family_member(family_id));
create policy "family members can update tournaments"
  on public.tournaments for update to authenticated
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

-- Consolidated first-install synchronization protocol.
begin;

alter table public.families
  add column if not exists sync_revision bigint not null default 0
  check (sync_revision >= 0);

create table if not exists public.sync_changes (
  family_id uuid not null references public.families(id) on delete cascade,
  revision bigint not null check (revision > 0),
  entity_type text not null check (entity_type in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points')),
  entity_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (family_id, revision)
);

create index if not exists sync_changes_entity_idx
  on public.sync_changes(family_id, entity_type, entity_id, revision desc);

create table if not exists public.sync_operations (
  family_id uuid not null references public.families(id) on delete cascade,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points')),
  entity_id uuid not null,
  base_version integer not null check (base_version >= 0),
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (family_id, operation_id)
);

create table if not exists public.sync_entity_snapshots (
  family_id uuid not null references public.families(id) on delete cascade,
  snapshot_revision bigint not null check (snapshot_revision >= 0),
  entity_type text not null check (entity_type in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points')),
  entity_id uuid not null,
  payload jsonb not null,
  primary key (family_id, snapshot_revision, entity_type, entity_id)
);

create index if not exists sync_entity_snapshots_lookup_idx
  on public.sync_entity_snapshots(family_id, entity_type, entity_id, snapshot_revision desc);

alter table public.sync_changes enable row level security;
alter table public.sync_operations enable row level security;
alter table public.sync_entity_snapshots enable row level security;
revoke all on table
  public.sync_changes,
  public.sync_operations,
  public.sync_entity_snapshots
from public, anon, authenticated;

revoke insert, update, delete on table
  public.players, public.clubs, public.tournaments, public.matches, public.sets, public.games, public.points
from public, anon, authenticated;

create or replace function public.pull_sync_changes(
  _family_id uuid,
  _after_revision bigint,
  _limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or _family_id is null
    or _after_revision is null or _after_revision < 0
    or _limit is null or _limit < 1 or _limit > 500 then
    raise exception 'Invalid sync cursor';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;

  select pg_catalog.jsonb_build_object(
    'changes', coalesce(pg_catalog.jsonb_agg(page.change order by page.revision), '[]'::jsonb),
    'next_revision', coalesce(pg_catalog.max(page.revision), _after_revision)
  )
  into result
  from (
    select
      change.revision,
      pg_catalog.jsonb_build_object(
        'revision', change.revision,
        'entity_type', change.entity_type,
        'entity_id', change.entity_id,
        'payload', change.payload
      ) as change
    from public.sync_changes change
    where change.family_id = _family_id and change.revision > _after_revision
    order by change.revision
    limit least(_limit, 500)
  ) page;

  return result;
end;
$$;

create or replace function public.apply_sync_record(
  _family_id uuid,
  _operation_id uuid,
  _entity_type text,
  _entity_id uuid,
  _base_version integer,
  _payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_table text;
  current_version integer;
  next_version integer;
  current_row jsonb;
  source_payload jsonb;
  update_columns text;
  updated_row jsonb;
  new_revision bigint;
  failed_constraint text;
  prior public.sync_operations%rowtype;
  payload_hash text;
  prior_result jsonb;
begin
  if auth.uid() is null or _family_id is null or _operation_id is null or _entity_id is null
    or _base_version is null or _base_version < 0
    or _payload is null or jsonb_typeof(_payload) <> 'object'
    or (_payload ->> 'id') is distinct from _entity_id::text then
    raise exception 'Invalid sync record';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;

  payload_hash := encode(extensions.digest(_payload::text, 'sha256'), 'hex');

  select * into prior
  from public.sync_operations
  where family_id = _family_id and operation_id = _operation_id
  for update;
  if found then
    if prior.entity_type <> _entity_type
      or prior.entity_id <> _entity_id
      or prior.base_version <> _base_version
      or prior.payload_hash <> payload_hash then
      raise exception 'Operation ID reuse with different sync input';
    end if;
    return prior.result;
  end if;

  target_table := case _entity_type
    when 'players' then 'players'
    when 'clubs' then 'clubs'
    when 'tournaments' then 'tournaments'
    when 'matches' then 'matches'
    when 'sets' then 'sets'
    when 'games' then 'games'
    when 'points' then 'points'
    else null
  end;
  if target_table is null then
    raise exception 'Unsupported sync entity';
  end if;

  execute pg_catalog.format(
    'select version, to_jsonb(record) from public.%I as record where id = $1 and family_id = $2 for update',
    target_table
  ) into current_version, current_row using _entity_id, _family_id;

  if (current_version is null and _base_version <> 0)
    or (current_version is not null and current_version <> _base_version) then
    prior_result := pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'reason', 'version',
      'remote_version', coalesce(current_version, 0),
      'record', current_row
    );
  else
    next_version := coalesce(current_version, 0) + 1;
    source_payload := (_payload - 'family_id' - 'version' - 'updated_at')
      || pg_catalog.jsonb_build_object(
        'id', _entity_id,
        'family_id', _family_id,
        'version', next_version,
        'updated_at', pg_catalog.clock_timestamp()
      );

    if current_row is null then
      execute pg_catalog.format(
        'insert into public.%I as inserted select (pg_catalog.jsonb_populate_record(null::public.%I, $1)).* returning pg_catalog.to_jsonb(inserted)',
        target_table, target_table
      ) into updated_row using source_payload;
    else
      select pg_catalog.string_agg(
        pg_catalog.format('%1$I = incoming.%1$I', attribute.attname), ', '
        order by attribute.attnum
      )
      into update_columns
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = pg_catalog.to_regclass('public.' || target_table)
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname not in ('id', 'family_id', 'created_at');

      execute pg_catalog.format(
        'update public.%I as target set %s from pg_catalog.jsonb_populate_record(null::public.%I, $1) as incoming where target.id = $2 and target.family_id = $3 returning pg_catalog.to_jsonb(target)',
        target_table, update_columns, target_table
      ) into updated_row using source_payload, _entity_id, _family_id;
    end if;

    update public.families
    set sync_revision = sync_revision + 1
    where id = _family_id
    returning sync_revision into new_revision;

    insert into public.sync_changes (family_id, revision, entity_type, entity_id, payload)
    values (_family_id, new_revision, _entity_type, _entity_id, updated_row);

    prior_result := pg_catalog.jsonb_build_object(
      'status', 'applied',
      'remote_version', next_version,
      'revision', new_revision,
      'record', updated_row
    );
  end if;

  insert into public.sync_operations (
    family_id, operation_id, entity_type, entity_id, base_version, payload_hash, result
  ) values (
    _family_id, _operation_id, _entity_type, _entity_id, _base_version, payload_hash, prior_result
  );

  return prior_result;
exception
  when unique_violation then
    get stacked diagnostics failed_constraint = constraint_name;
    select * into prior
    from public.sync_operations
    where family_id = _family_id and operation_id = _operation_id;
    if found then
      if prior.entity_type <> _entity_type
        or prior.entity_id <> _entity_id
        or prior.base_version <> _base_version
        or prior.payload_hash <> encode(extensions.digest(_payload::text, 'sha256'), 'hex') then
        raise exception 'Operation ID reuse with different sync input';
      end if;
      return prior.result;
    end if;
    if target_table is not null then
      execute pg_catalog.format(
        'select version, to_jsonb(record) from public.%I as record where id = $1 and family_id = $2 for update',
        target_table
      ) into current_version, current_row using _entity_id, _family_id;
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'reason', 'constraint',
      'remote_version', coalesce(current_version, 0),
      'record', current_row,
      'constraint', failed_constraint
    );
end;
$$;

create or replace function public.record_sync_entity_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sync_entity_snapshots (
    family_id, snapshot_revision, entity_type, entity_id, payload
  ) values (
    new.family_id, new.revision, new.entity_type, new.entity_id, new.payload
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists sync_changes_record_snapshot on public.sync_changes;
create trigger sync_changes_record_snapshot
after insert on public.sync_changes
for each row execute function public.record_sync_entity_snapshot();

create or replace function public.begin_initial_snapshot(_family_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision bigint;
begin
  if auth.uid() is null or _family_id is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;

  select f.sync_revision into revision
  from public.families f
  where f.id = _family_id
  for share;
  if not found then
    raise exception 'Family not found';
  end if;
  return revision;
end;
$$;

create or replace function public.list_initial_snapshot(
  _family_id uuid,
  _snapshot_revision bigint,
  _entity_type text,
  _after_id uuid default '00000000-0000-0000-0000-000000000000',
  _limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page jsonb;
begin
  if auth.uid() is null or _family_id is null or _snapshot_revision is null
    or _snapshot_revision < 0 or _entity_type is null
    or _limit is null or _limit < 1 or _limit > 500
    or _after_id is null then
    raise exception 'Invalid snapshot request';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;
  if _entity_type not in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points') then
    raise exception 'Unsupported sync entity';
  end if;

  select coalesce(jsonb_agg(snapshot.payload order by snapshot.entity_id), '[]'::jsonb)
  into page
  from (
    select distinct on (snap.entity_id)
      snap.entity_id,
      snap.payload
    from public.sync_entity_snapshots snap
    where snap.family_id = _family_id
      and snap.entity_type = _entity_type
      and snap.snapshot_revision <= _snapshot_revision
      and snap.entity_id > _after_id
    order by snap.entity_id, snap.snapshot_revision desc
    limit least(_limit, 500)
  ) snapshot;

  return page;
end;
$$;

revoke all on function public.pull_sync_changes(uuid, bigint, integer) from public, anon;
revoke all on function public.apply_sync_record(uuid, uuid, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.record_sync_entity_snapshot() from public, anon, authenticated;
revoke all on function public.begin_initial_snapshot(uuid) from public, anon;
revoke all on function public.list_initial_snapshot(uuid, bigint, text, uuid, integer) from public, anon;
grant execute on function public.pull_sync_changes(uuid, bigint, integer) to authenticated;
grant execute on function public.apply_sync_record(uuid, uuid, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.begin_initial_snapshot(uuid) to authenticated;
grant execute on function public.list_initial_snapshot(uuid, bigint, text, uuid, integer) to authenticated;

commit;

-- Point types are read-only reference data for signed-in users.
begin;

revoke all on table public.point_types from public, anon;
grant select on table public.point_types to authenticated;
alter table public.point_types enable row level security;
create policy "authenticated users can read point types"
  on public.point_types for select to authenticated
  using (true);

commit;

-- Player age categories (FITP age sectors).
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

-- Tournament categories are age categories (the tournaments table is created before this one).
alter table public.tournaments
  add constraint tournaments_age_category_id_fkey
  foreign key (age_category_id) references public.player_age_categories(id);

revoke all on table public.player_age_categories from public, anon;
grant select on table public.player_age_categories to authenticated;
alter table public.player_age_categories enable row level security;
drop policy if exists "authenticated users can read player age categories" on public.player_age_categories;
create policy "authenticated users can read player age categories"
  on public.player_age_categories for select to authenticated
  using (true);

commit;

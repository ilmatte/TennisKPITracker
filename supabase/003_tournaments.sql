-- Adds tournaments to a Supabase project created before the tournaments table existed (run 002_clubs.sql first if
-- the project has no clubs table either). New projects get everything from initial_schema.sql.
-- Tournaments are family data synchronized like clubs: each one belongs to a club and to an age category, and
-- matches point to their tournament through matches.tournament_id (null for matches created before tournaments).
-- The free-text matches.tournament column is DROPPED, together with the names it holds. The sync tables and functions
-- accept the new 'tournaments' entity type. Idempotent: safe to run more than once. Run it BEFORE deploying the app
-- version with tournaments.

begin;

-- Tournaments the family takes part in. club_id: hosting club. age_category_id: FK to player_age_categories; the
-- app offers U12 to Open.
create table if not exists public.tournaments (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  club_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  age_category_id smallint not null,
  start_date date not null,
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
create index if not exists tournaments_family_id_idx on public.tournaments(family_id, updated_at desc);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'tournaments_age_category_id_fkey' and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_age_category_id_fkey
      foreign key (age_category_id) references public.player_age_categories(id);
  end if;
end;
$$;

-- Same access rules as the other sporting tables: members read; writes go through the sync functions only.
revoke all on table public.tournaments from public, anon, authenticated;
grant select on table public.tournaments to authenticated;
alter table public.tournaments enable row level security;
drop policy if exists "family members can read tournaments" on public.tournaments;
create policy "family members can read tournaments"
  on public.tournaments for select to authenticated
  using (private.is_family_member(family_id));
drop policy if exists "family members can insert tournaments" on public.tournaments;
create policy "family members can insert tournaments"
  on public.tournaments for insert to authenticated
  with check (private.is_family_member(family_id));
drop policy if exists "family members can update tournaments" on public.tournaments;
create policy "family members can update tournaments"
  on public.tournaments for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

-- Matches point to their tournament.
alter table public.matches add column if not exists tournament_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'matches_family_id_tournament_id_fkey' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_family_id_tournament_id_fkey foreign key (family_id, tournament_id)
      references public.tournaments(family_id, id)
      on delete no action
      deferrable initially deferred;
  end if;
end;
$$;
create index if not exists matches_family_tournament_idx on public.matches(family_id, tournament_id);

-- The free-text tournament name is replaced by tournament_id.
alter table public.matches drop column if exists tournament;

-- The sync tables accept the 'tournaments' entity type.
alter table public.sync_changes drop constraint if exists sync_changes_entity_type_check,
  add constraint sync_changes_entity_type_check
  check (entity_type in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'));
alter table public.sync_operations drop constraint if exists sync_operations_entity_type_check,
  add constraint sync_operations_entity_type_check
  check (entity_type in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'));
alter table public.sync_entity_snapshots drop constraint if exists sync_entity_snapshots_entity_type_check,
  add constraint sync_entity_snapshots_entity_type_check
  check (entity_type in ('players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'));

-- The sync functions accept the 'tournaments' entity type (same definitions as initial_schema.sql).
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

commit;

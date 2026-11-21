begin;

alter table public.families
  add column if not exists sync_revision bigint not null default 0
  check (sync_revision >= 0);

create table if not exists public.sync_changes (
  family_id uuid not null references public.families(id) on delete cascade,
  revision bigint not null check (revision > 0),
  entity_type text not null check (entity_type in ('players', 'matches', 'sets', 'games', 'points')),
  entity_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (family_id, revision)
);

create index if not exists sync_changes_entity_idx
  on public.sync_changes(family_id, entity_type, entity_id, revision desc);

alter table public.sync_changes enable row level security;
revoke all on table public.sync_changes from public, anon, authenticated;

revoke insert, update, delete on table
  public.players, public.matches, public.sets, public.games, public.points
from public, anon, authenticated;

drop policy if exists "family members can insert players" on public.players;
drop policy if exists "family members can update players" on public.players;
drop policy if exists "family members can insert matches" on public.matches;
drop policy if exists "family members can update matches" on public.matches;
drop policy if exists "family members can insert sets" on public.sets;
drop policy if exists "family members can update sets" on public.sets;
drop policy if exists "family members can insert games" on public.games;
drop policy if exists "family members can update games" on public.games;
drop policy if exists "family members can insert points" on public.points;
drop policy if exists "family members can update points" on public.points;

create or replace function public.apply_sync_record(
  _family_id uuid,
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
begin
  if auth.uid() is null or _family_id is null or _entity_id is null
    or _base_version is null or _base_version < 0
    or _payload is null or jsonb_typeof(_payload) <> 'object'
    or (_payload ->> 'id') is distinct from _entity_id::text then
    raise exception 'Invalid sync record';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;

  target_table := case _entity_type
    when 'players' then 'players'
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
    'select version, to_jsonb(record) from public.%I as record where id = $1 for update',
    target_table
  ) into current_version, current_row using _entity_id;

  if current_row is not null and current_row ->> 'family_id' <> _family_id::text then
    raise exception 'Record belongs to another family';
  end if;
  if (current_version is null and _base_version <> 0)
    or (current_version is not null and current_version <> _base_version) then
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'reason', 'version',
      'remote_version', coalesce(current_version, 0),
      'record', current_row
    );
  end if;

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
      'update public.%I as target set %s from pg_catalog.jsonb_populate_record(null::public.%I, $1) as incoming where target.id = $2 returning pg_catalog.to_jsonb(target)',
      target_table, update_columns, target_table
    ) into updated_row using source_payload, _entity_id;
  end if;

  update public.families
  set sync_revision = sync_revision + 1
  where id = _family_id
  returning sync_revision into new_revision;

  insert into public.sync_changes (family_id, revision, entity_type, entity_id, payload)
  values (_family_id, new_revision, _entity_type, _entity_id, updated_row);

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'remote_version', next_version,
    'revision', new_revision,
    'record', updated_row
  );
exception
  when unique_violation then
    get stacked diagnostics failed_constraint = constraint_name;
    if target_table is not null then
      execute pg_catalog.format(
        'select version, to_jsonb(record) from public.%I as record where id = $1 for update',
        target_table
      ) into current_version, current_row using _entity_id;
    end if;
    if current_row is not null and current_row ->> 'family_id' = _family_id::text then
      return pg_catalog.jsonb_build_object(
        'status', 'conflict',
        'reason', 'version',
        'remote_version', current_version,
        'record', current_row
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'reason', 'constraint',
      'remote_version', coalesce(current_version, 0),
      'record', null,
      'constraint', failed_constraint
    );
end;
$$;

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
    or _limit is null or _limit < 1 then
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

revoke all on function public.apply_sync_record(uuid, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.pull_sync_changes(uuid, bigint, integer) from public, anon;
grant execute on function public.apply_sync_record(uuid, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.pull_sync_changes(uuid, bigint, integer) to authenticated;

commit;

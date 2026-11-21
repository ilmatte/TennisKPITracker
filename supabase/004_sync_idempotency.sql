begin;

create table if not exists public.sync_operations (
  family_id uuid not null references public.families(id) on delete cascade,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('players', 'matches', 'sets', 'games', 'points')),
  entity_id uuid not null,
  base_version integer not null check (base_version >= 0),
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (family_id, operation_id)
);

alter table public.sync_operations enable row level security;
revoke all on table public.sync_operations from public, anon, authenticated;

alter table if exists public.family_invitations enable row level security;
revoke all on table public.family_invitations from public, anon, authenticated;

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

revoke all on function public.apply_sync_record(uuid, uuid, text, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_sync_record(uuid, uuid, text, uuid, integer, jsonb) to authenticated;

-- Prevent clients of the pre-idempotency 003 overload from bypassing operation records.
revoke all on function public.apply_sync_record(uuid, text, uuid, integer, jsonb) from public, anon, authenticated;

commit;

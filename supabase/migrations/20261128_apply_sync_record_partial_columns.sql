-- Fix: apply_sync_record writes only the columns present in the payload (missing ones keep their value / default).
begin;
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
  insert_columns text;
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

    -- Only the columns present in the payload are written: a payload produced by an older app version or downloaded
    -- from an old sync snapshot may lack columns added later; on insert they get their default, on update they keep
    -- their current value (instead of being overwritten with null, which breaks the not null constraints).
    if current_row is null then
      select pg_catalog.string_agg(pg_catalog.format('%I', attribute.attname), ', ' order by attribute.attnum)
      into insert_columns
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = pg_catalog.to_regclass('public.' || target_table)
        and attribute.attnum > 0
        and not attribute.attisdropped
        and source_payload ? attribute.attname::text;

      execute pg_catalog.format(
        'insert into public.%I as inserted (%s) select %s from pg_catalog.jsonb_populate_record(null::public.%I, $1) as incoming returning pg_catalog.to_jsonb(inserted)',
        target_table, insert_columns, insert_columns, target_table
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
        and attribute.attname not in ('id', 'family_id', 'created_at')
        and source_payload ? attribute.attname::text;

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

-- Repair: old sync copies (written before columns such as matches.short_set_tiebreak_at existed) get the missing
-- keys from the current row, so devices downloading them receive complete records.
do $$
declare
  t text;
  log_table text;
begin
  foreach log_table in array array['sync_entity_snapshots', 'sync_changes'] loop
    foreach t in array array['players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'] loop
      execute format($f$
        update public.%I copy
        set payload = coalesce((
          select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(r)) e where not copy.payload ? e.key
        ), '{}'::jsonb) || copy.payload
        from public.%I r
        where copy.entity_type = %L and r.id = copy.entity_id and r.family_id = copy.family_id
          and exists (select 1 from jsonb_object_keys(to_jsonb(r)) k where not copy.payload ? k)
      $f$, log_table, t, t);
    end loop;
  end loop;
end
$$;

commit;

-- Comunica - CAA: keep one canonical Auth profile writer.
-- Apply after 003. Re-execution is safe; no accounts or profiles are backfilled,
-- updated or deleted. Supabase owns auth.users, so its triggers are not altered.
-- Only the verified, exclusively bound legacy duplicate function becomes a no-op;
-- both trigger objects, all other triggers, function owners and ACLs are retained.
begin;
set local lock_timeout = '5s';

-- Serialize this short catalog/trigger repair with concurrent Auth inserts.
-- If the lock cannot be acquired promptly, the transaction fails unchanged.
lock table auth.users in share row exclusive mode;

do $$
declare
  v_profiles regclass := pg_catalog.to_regclass('public.caa_profiles');
  v_canonical regprocedure := pg_catalog.to_regprocedure('comunica_react_private.handle_new_user()');
  v_legacy regprocedure := pg_catalog.to_regprocedure('comunica_private.new_user()');
  v_column record;
  v_id smallint;
  v_role smallint;
  v_auth_id smallint;
  v_legacy_body text;
begin
  if v_profiles is null or not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = v_profiles and c.relkind = 'r' and c.relrowsecurity
  ) then
    raise exception 'Expected the canonical caa_profiles table with RLS enabled. Apply and verify migration 003 before this repair.';
  end if;

  for v_column in select * from (values
    ('id', 'pg_catalog.uuid'::regtype, true),
    ('nome', 'pg_catalog.text'::regtype, true),
    ('created_at', 'pg_catalog.timestamptz'::regtype, true),
    ('updated_at', 'pg_catalog.timestamptz'::regtype, true),
    ('role', 'pg_catalog.text'::regtype, false)
  ) as required(name, type_oid, not_null)
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = v_profiles and a.attname = v_column.name
        and a.attnum > 0 and not a.attisdropped
        and a.atttypid = v_column.type_oid and a.attnotnull = v_column.not_null
    ) then
      raise exception 'Unexpected caa_profiles column %. Review the existing schema before this repair.', v_column.name;
    end if;
  end loop;

  select a.attnum into v_id from pg_catalog.pg_attribute a
    where a.attrelid = v_profiles and a.attname = 'id';
  select a.attnum into v_role from pg_catalog.pg_attribute a
    where a.attrelid = v_profiles and a.attname = 'role';
  select a.attnum into v_auth_id from pg_catalog.pg_attribute a
    where a.attrelid = 'auth.users'::regclass and a.attname = 'id';

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = v_profiles and c.contype = 'p'
      and c.conkey = array[v_id] and c.convalidated
  ) or not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = v_profiles and c.contype = 'f'
      and c.conkey = array[v_id] and c.confrelid = 'auth.users'::regclass
      and c.confkey = array[v_auth_id] and c.confdeltype = 'c' and c.convalidated
  ) then
    raise exception 'Expected canonical profile identity constraints. Review the existing schema before this repair.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = v_profiles and c.contype = 'c'
      and c.conname = 'caa_profiles_role_check' and c.convalidated
      and c.conkey = array[v_role]
      and pg_catalog.regexp_replace(pg_catalog.pg_get_expr(c.conbin, c.conrelid), '\s+', '', 'g')
        = $role_check$(role=ANY(ARRAY['responsavel'::text,'fonoaudiologo'::text]))$role_check$
  ) then
    raise exception 'Expected the canonical account-role constraint from migration 003. Review the existing schema before this repair.';
  end if;

  if v_canonical is null or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_canonical and p.pronargs = 0
      and p.prokind = 'f' and p.prorettype = 'pg_catalog.trigger'::regtype
      and p.prosecdef
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'comunica_react_user_created'
      and t.tgfoid = v_canonical and not t.tgisinternal
      and t.tgtype = 5 and t.tgenabled = 'O'
      and t.tgnargs = 0 and t.tgqual is null and t.tgconstraint = 0
  ) then
    raise exception 'The canonical Auth profile trigger differs from the verified configuration. No trigger was changed.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and t.tgname = 'comunica_new_user'
  ) and (
    v_legacy is null or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_legacy and p.pronargs = 0
        and p.prokind = 'f' and p.prorettype = 'pg_catalog.trigger'::regtype
        and p.prosecdef
        and p.prolang = (select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql')
        and p.proconfig = array['search_path=""']
    ) or not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'auth.users'::regclass and t.tgname = 'comunica_new_user'
        and t.tgfoid = v_legacy and not t.tgisinternal
        and t.tgtype = 5 and t.tgenabled in ('O', 'D')
        and t.tgnargs = 0 and t.tgqual is null and t.tgconstraint = 0
    )
  ) then
    raise exception 'The legacy Auth trigger name is attached to an unexpected function or event. No trigger was changed.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and t.tgname = 'comunica_new_user'
  ) then
    if exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgfoid = v_legacy
        and (t.tgrelid <> 'auth.users'::regclass or t.tgname <> 'comunica_new_user')
    ) then
      raise exception 'The legacy function is used by another trigger. Review its consumers before this repair.';
    end if;
    select pg_catalog.regexp_replace(pg_catalog.lower(p.prosrc), '\s+', '', 'g')
      into v_legacy_body from pg_catalog.pg_proc p where p.oid = v_legacy;
    -- Recognize only the observed duplicate writer, the original legacy writer
    -- shipped in 001_comunica.sql, or this repair's exact no-op on a repeat run.
    if v_legacy_body not in (
      $observed$beginifnotexists(select1frompublic.caa_profileswhereid=new.id)theninsertintopublic.caa_profiles(id,nome,role)values(new.id,btrim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'role');endif;returnnew;end;$observed$,
      $observed_comment$begin--verificaseoperfiljáexisteantesdetentarinseririfnotexists(select1frompublic.caa_profileswhereid=new.id)theninsertintopublic.caa_profiles(id,nome,role)values(new.id,btrim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'role');endif;returnnew;end;$observed_comment$,
      $original$beginifcoalesce(new.raw_user_meta_data->>'consent','false')<>'true'thenraiseexception'confirmeoavisodearmazenamentodedados.';endif;insertintopublic.caa_profiles(id,name,role)values(new.id,btrim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'role');returnnew;end;$original$,
      $noop$beginreturnnew;end;$noop$
    ) then
      raise exception 'The legacy function contains unrecognized logic. Review its definition before this repair.';
    end if;
  end if;
end;
$$;

-- Preserve the validation rules of migration 003. An existing canonical row is
-- never overwritten, including its role, name or timestamps. The canonical
-- trigger remains the only profile writer after the legacy no-op below.
create or replace function comunica_react_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  v_role text;
begin
  if v_provider = 'email' then
    v_role := new.raw_user_meta_data ->> 'role';
    if v_role is null or v_role not in ('responsavel', 'fonoaudiologo') then
      raise invalid_parameter_value using message = 'Choose a valid account role.';
    end if;
    if (new.raw_user_meta_data -> 'consent') is distinct from 'true'::jsonb then
      raise invalid_parameter_value using message = 'Storage acknowledgement is required.';
    end if;
  elsif v_provider = 'google' then
    v_role := null;
  else
    raise invalid_parameter_value using message = 'Unsupported authentication provider.';
  end if;
  insert into public.caa_profiles (id, nome, role)
  values (
    new.id,
    pg_catalog.left(coalesce(
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'nome'), ''),
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'name'), ''),
      'Usuario'
    ), 80),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function comunica_react_private.handle_new_user() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and t.tgname = 'comunica_new_user'
  ) then
    -- CREATE OR REPLACE preserves the existing function owner and permissions.
    -- The verified SECURITY DEFINER and empty search_path are preserved as well.
    -- A managed Auth table need not grant ownership to the migration operator.
    execute $replace_legacy$
      create or replace function comunica_private.new_user()
      returns trigger language plpgsql security definer set search_path = '' as
      $legacy_noop$begin return new; end;$legacy_noop$
    $replace_legacy$;
  end if;
end;
$$;

commit;

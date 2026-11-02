-- Comunica - CAA: authoritative account roles and verified-email access.
-- Apply once after migrations 001 and 002. No Auth or application data is erased.
-- Google accounts complete their role through complete_caa_profile after sign-in.
begin;

do $$
begin
  if pg_catalog.to_regclass('public.caa_profiles') is not null then
    raise exception 'caa_profiles already exists. Reconcile the existing schema before migration 003; no existing data was changed.';
  end if;
  if pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'Apply migrations 001 and 002 before migration 003.';
  end if;
  if exists (
    select 1 from public.profiles p
    where exists (select 1 from public.criancas c where c.usuario_id = p.id)
      and exists (select 1 from public.caa_members m where m.professional_id = p.id)
  ) then
    raise exception 'An existing account has both guardian and professional data. Reconcile its account role before migration 003; no existing data was changed.';
  end if;
end;
$$;

-- PostgreSQL retains the table OID and automatically updates all foreign keys.
alter table public.profiles rename to caa_profiles;
alter table public.caa_profiles add column role text
  constraint caa_profiles_role_check check (role in ('responsavel', 'fonoaudiologo'));

-- Existing professional membership is authoritative; mutable Auth metadata is not.
update public.caa_profiles p set role = case
  when exists (select 1 from public.caa_members m where m.professional_id = p.id)
    then 'fonoaudiologo'
  else 'responsavel'
end;

alter trigger profiles_touch_updated_at on public.caa_profiles rename to caa_profiles_touch_updated_at;
alter table public.caa_profiles enable row level security;
revoke all on public.caa_profiles from public, anon, authenticated;
-- Column grants survive table-level REVOKE; explicitly remove the old INSERT.
revoke insert (id, nome), update (nome) on public.caa_profiles from public, anon, authenticated;
grant select on public.caa_profiles to authenticated;
grant update (nome) on public.caa_profiles to authenticated;

drop policy profiles_select_own on public.caa_profiles;
drop policy profiles_insert_own on public.caa_profiles;
drop policy profiles_update_own on public.caa_profiles;
create policy caa_profiles_select_own on public.caa_profiles
  for select to authenticated using (id = (select auth.uid()));
create policy caa_profiles_update_name_own on public.caa_profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- A client may read its own pending profile, but only a confirmed account with
-- a canonical database role receives access to patients, events or invitations.
create function comunica_react_private.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.caa_profiles p
    join auth.users u on u.id = p.id
    where p.id = (select auth.uid()) and p.role = p_role
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function comunica_react_private.has_role(text) from public, anon, authenticated;
grant usage on schema comunica_react_private to authenticated;
grant execute on function comunica_react_private.has_role(text) to authenticated;

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
    -- Provider metadata does not grant a role. Complete it once after OAuth.
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
  );
  return new;
end;
$$;
revoke all on function comunica_react_private.handle_new_user() from public, anon, authenticated;

create function public.complete_caa_profile(
  p_role text, p_nome text, p_consent boolean, p_expected_user_id uuid
)
returns setof public.caa_profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  -- Bind the submitted form to its original account. The SDK may change its
  -- current session in another tab while this request is being prepared.
  if v_uid is null or p_expected_user_id is distinct from v_uid or not exists (
    select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
  ) then
    raise insufficient_privilege using message = 'A confirmed matching account is required.';
  end if;
  if p_role is null or p_role not in ('responsavel', 'fonoaudiologo')
    or p_nome is null or char_length(pg_catalog.btrim(p_nome)) not between 1 and 80
    or p_consent is distinct from true then
    raise invalid_parameter_value using message = 'Choose a role, enter a valid name and acknowledge storage.';
  end if;
  -- Serializing this row prevents a second request from changing an assigned role.
  select p.role into v_role from public.caa_profiles p where p.id = v_uid for update;
  if not found or v_role is not null then
    raise insufficient_privilege using message = 'Account role has already been assigned.';
  end if;
  return query update public.caa_profiles p
    set role = p_role, nome = pg_catalog.btrim(p_nome)
    where p.id = v_uid and p.role is null returning p.*;
end;
$$;
revoke all on function public.complete_caa_profile(text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.complete_caa_profile(text, text, boolean, uuid) to authenticated;

create or replace function comunica_links_private.owns_child(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_react_private.has_role('responsavel') and exists (
    select 1 from public.criancas c
    where c.id = p_crianca_id and c.usuario_id = (select auth.uid())
  );
$$;
create or replace function comunica_links_private.is_member(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_react_private.has_role('fonoaudiologo') and exists (
    select 1 from public.caa_members m
    where m.crianca_id = p_crianca_id and m.professional_id = (select auth.uid())
  );
$$;

drop policy criancas_select_own on public.criancas;
drop policy criancas_insert_own on public.criancas;
drop policy criancas_update_own on public.criancas;
drop policy criancas_delete_own on public.criancas;
create policy criancas_select_own on public.criancas
  for select to authenticated using (
    usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel')
  );
create policy criancas_insert_own on public.criancas
  for insert to authenticated with check (
    usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel')
  );
create policy criancas_update_own on public.criancas
  for update to authenticated
  using (usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel'))
  with check (usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel'));
create policy criancas_delete_own on public.criancas
  for delete to authenticated using (
    usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel')
  );

drop policy comunicacoes_select_own on public.comunicacoes;
drop policy comunicacoes_insert_own on public.comunicacoes;
drop policy comunicacoes_delete_own on public.comunicacoes;
create policy comunicacoes_select_own on public.comunicacoes
  for select to authenticated using (
    usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel')
  );
create policy comunicacoes_insert_own on public.comunicacoes
  for insert to authenticated with check (
    usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel')
  );
create policy comunicacoes_delete_own on public.comunicacoes
  for delete to authenticated using (
    usuario_id = (select auth.uid()) and comunica_react_private.has_role('responsavel')
  );

drop policy caa_members_select_participants on public.caa_members;
create policy caa_members_select_participants on public.caa_members
  for select to authenticated using (
    (professional_id = (select auth.uid()) and comunica_react_private.has_role('fonoaudiologo'))
    or comunica_links_private.owns_child(crianca_id)
  );

-- The policies installed in 002 call the replaced ownership/membership helpers.
-- The security_invoker caa_events view continues to inherit the same RLS.

create or replace function public.create_caa_invitation(p_crianca_id uuid)
returns table (
  id uuid, crianca_id uuid, code text, expires_at timestamptz,
  is_used boolean, created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_code text;
  v_previous text;
  v_random bigint;
  v_try integer;
begin
  if v_uid is null then raise insufficient_privilege using message = 'Authentication required.'; end if;
  if not comunica_react_private.has_role('responsavel') then
    raise insufficient_privilege using message = 'A confirmed guardian account is required.';
  end if;
  -- Locking the owner row serializes regeneration of this child's code.
  perform 1 from public.criancas c
    where c.id = p_crianca_id and c.usuario_id = v_uid for no key update;
  if not found then raise insufficient_privilege using message = 'Child access denied.'; end if;
  v_now := pg_catalog.clock_timestamp();
  select i.code into v_previous from public.caa_invitations i where i.crianca_id = p_crianca_id;
  for v_try in 1..50 loop
    -- gen_random_uuid is cryptographically random. Rejection sampling avoids
    -- modulo bias and needs no pgcrypto extension or exposed client secret.
    loop
      v_random := ('x' || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint;
      exit when v_random < 4294000000;
    end loop;
    v_code := pg_catalog.lpad((v_random % 1000000)::text, 6, '0');
    continue when v_code = v_previous;
    begin
      return query
        insert into public.caa_invitations as i (crianca_id, code, expires_at, is_used, created_at)
        values (p_crianca_id, v_code, v_now + interval '24 hours', false, v_now)
        on conflict on constraint caa_invitations_crianca_id_key do update
          set code = excluded.code, expires_at = excluded.expires_at,
              is_used = false, created_at = excluded.created_at
        returning i.id, i.crianca_id, i.code, i.expires_at, i.is_used, i.created_at;
      return;
    exception when unique_violation then
      -- A collision with another child's code never leaks its data.
      null;
    end;
  end loop;
  raise exception using errcode = 'P0001', message = 'Could not generate invitation. Try again.';
end;
$$;

create or replace function public.redeem_caa_invitation(p_code text)
returns table (status text, crianca_id uuid, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_attempt comunica_links_private.redemption_attempts%rowtype;
  v_invite public.caa_invitations%rowtype;
  v_owner uuid;
  v_inserted integer;
  v_retry integer;
begin
  if v_uid is null then raise insufficient_privilege using message = 'Authentication required.'; end if;
  if not comunica_react_private.has_role('fonoaudiologo') then
    raise insufficient_privilege using message = 'A confirmed professional account is required.';
  end if;
  insert into comunica_links_private.redemption_attempts (user_id, window_started_at)
    values (v_uid, v_now) on conflict (user_id) do nothing;
  select a.* into v_attempt from comunica_links_private.redemption_attempts a
    where a.user_id = v_uid for update;
  if v_attempt.window_started_at + interval '15 minutes' <= v_now then
    update comunica_links_private.redemption_attempts
      set window_started_at = v_now, failed_attempts = 0 where user_id = v_uid;
    v_attempt.window_started_at := v_now;
    v_attempt.failed_attempts := 0;
  end if;
  v_retry := greatest(1, pg_catalog.ceil(extract(epoch from (v_attempt.window_started_at + interval '15 minutes' - v_now)))::integer);
  if v_attempt.failed_attempts >= 5 then
    return query select 'rate_limited'::text, null::uuid, v_retry;
    return;
  end if;
  if char_length(p_code) = 6 and p_code ~ '^[0-9]{6}$' then
    -- FOR UPDATE makes link creation and single-use consumption atomic even
    -- when two different professionals redeem the same code concurrently.
    select i.* into v_invite from public.caa_invitations i where i.code = p_code for update;
    if found and not v_invite.is_used and v_invite.expires_at > pg_catalog.clock_timestamp() then
      select c.usuario_id into v_owner from public.criancas c where c.id = v_invite.crianca_id;
      if v_owner is not null and v_owner <> v_uid and exists (
        select 1 from public.caa_profiles p where p.id = v_owner and p.role = 'responsavel'
      ) then
        insert into public.caa_members (crianca_id, professional_id)
          values (v_invite.crianca_id, v_uid)
          on conflict on constraint caa_members_crianca_id_professional_id_key do nothing;
        get diagnostics v_inserted = row_count;
        update public.caa_invitations set is_used = true where id = v_invite.id;
        return query select case when v_inserted = 1 then 'linked' else 'already_linked' end,
          v_invite.crianca_id, 0;
        return;
      end if;
    end if;
  end if;
  update comunica_links_private.redemption_attempts set failed_attempts = failed_attempts + 1
    where user_id = v_uid;
  -- Returning failure rather than raising preserves the attempt counter.
  return query select case when v_attempt.failed_attempts + 1 >= 5 then 'rate_limited' else 'invalid' end,
    null::uuid, case when v_attempt.failed_attempts + 1 >= 5 then v_retry else 0 end;
end;
$$;

create or replace function public.list_caa_members(p_crianca_id uuid)
returns table (professional_id uuid, professional_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Child access denied.';
  end if;
  return query select m.professional_id, p.nome, m.created_at
    from public.caa_members m join public.caa_profiles p on p.id = m.professional_id
    where m.crianca_id = p_crianca_id order by p.nome, m.professional_id;
end;
$$;

create or replace function public.revoke_caa_member(p_crianca_id uuid, p_professional_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Child access denied.';
  end if;
  delete from public.caa_members m
    where m.crianca_id = p_crianca_id and m.professional_id = p_professional_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.create_caa_invitation(uuid), public.redeem_caa_invitation(text),
  public.list_caa_members(uuid), public.revoke_caa_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_caa_invitation(uuid), public.redeem_caa_invitation(text),
  public.list_caa_members(uuid), public.revoke_caa_member(uuid, uuid) to authenticated;


commit;

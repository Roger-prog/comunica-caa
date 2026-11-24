begin;
set local lock_timeout = '5s';

do $$
declare v_constraint name;
begin
  select c.conname into strict v_constraint
  from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.caa_profiles'::regclass and c.contype = 'c'
    and a.attname = 'professional_category';
  execute format('alter table public.caa_profiles drop constraint %I', v_constraint);
end;
$$;
alter table public.caa_profiles add constraint caa_profiles_professional_category_check
  check (professional_category in ('Fonoaudiólogo', 'Terapeuta ocupacional', 'Fisioterapeuta',
    'Psicólogo', 'Professor', 'Médico', 'Outro profissional'));
alter table public.caa_profiles add column professional_registration text
  check (char_length(professional_registration) between 1 and 80);
alter table public.caa_profiles add column professional_validated_at timestamptz;
grant update (professional_registration) on public.caa_profiles to authenticated;

create table comunica_react_private.account_roles (
  user_id uuid not null references public.caa_profiles(id) on delete cascade,
  role text not null check (role in ('responsavel', 'fonoaudiologo')),
  primary key (user_id, role)
);
insert into comunica_react_private.account_roles (user_id, role)
  select id, role from public.caa_profiles where role is not null;

create table comunica_react_private.professional_requests (
  user_id uuid primary key references public.caa_profiles(id) on delete cascade,
  category text not null check (category in ('Fonoaudiólogo', 'Terapeuta ocupacional', 'Fisioterapeuta',
    'Psicólogo', 'Professor', 'Médico', 'Outro profissional')),
  registration text check (char_length(registration) between 1 and 80),
  requested_at timestamptz not null default clock_timestamp()
);
alter table comunica_react_private.account_roles enable row level security;
alter table comunica_react_private.professional_requests enable row level security;
revoke all on comunica_react_private.account_roles, comunica_react_private.professional_requests
  from public, anon, authenticated;

create function comunica_react_private.register_initial_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is not null and (tg_op = 'INSERT' or old.role is null) then
    insert into comunica_react_private.account_roles (user_id, role) values (new.id, new.role)
      on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function comunica_react_private.register_initial_role() from public, anon, authenticated;
create trigger caa_register_initial_role after insert or update of role on public.caa_profiles
  for each row execute function comunica_react_private.register_initial_role();

create function comunica_react_private.account_has_role(p_user_id uuid, p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from comunica_react_private.account_roles r join auth.users u on u.id = r.user_id
      where r.user_id = p_user_id and r.role = p_role and u.email_confirmed_at is not null
  );
$$;
revoke all on function comunica_react_private.account_has_role(uuid,text) from public, anon, authenticated;

create or replace function comunica_react_private.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_react_private.account_has_role(auth.uid(), p_role) and exists (
    select from public.caa_profiles p where p.id = auth.uid() and p.role = p_role
  );
$$;

create function public.get_caa_account_options()
returns table (roles text[], professional_pending boolean, professional_category text,
  professional_registration text, professional_validated boolean)
language sql stable security definer set search_path = '' as $$
  select array(select r.role from comunica_react_private.account_roles r
      where r.user_id = p.id order by r.role),
    q.user_id is not null, coalesce(q.category, p.professional_category),
    coalesce(q.registration, p.professional_registration), p.professional_validated_at is not null
  from public.caa_profiles p
  left join comunica_react_private.professional_requests q on q.user_id = p.id
  where p.id = auth.uid() and comunica_react_private.account_has_role(p.id, p.role);
$$;

create function public.switch_caa_account_role(p_expected_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from p_expected_user_id
     or not comunica_react_private.account_has_role(auth.uid(), p_role) then
    raise insufficient_privilege using message = 'Account role is not authorized.';
  end if;
  update public.caa_profiles set role = p_role where id = auth.uid();
end;
$$;

create function public.request_caa_account_role(p_expected_user_id uuid, p_role text,
  p_category text, p_registration text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile public.caa_profiles;
begin
  select p.* into v_profile from public.caa_profiles p where p.id = auth.uid() for update;
  if auth.uid() is distinct from p_expected_user_id
    or not comunica_react_private.account_has_role(auth.uid(), v_profile.role) then
    raise insufficient_privilege;
  end if;
  if p_role = 'responsavel' and v_profile.role = 'fonoaudiologo' then
    insert into comunica_react_private.account_roles (user_id, role) values (auth.uid(), p_role)
      on conflict do nothing;
  elsif p_role = 'fonoaudiologo' and (
    (v_profile.role = 'responsavel' and not comunica_react_private.account_has_role(auth.uid(), p_role))
    or (v_profile.role = 'fonoaudiologo' and v_profile.professional_validated_at is null)
  ) then
    insert into comunica_react_private.professional_requests (user_id, category, registration)
      values (auth.uid(), p_category, nullif(btrim(p_registration), ''))
      on conflict (user_id) do update set category = excluded.category,
        registration = excluded.registration, requested_at = clock_timestamp();
  else
    raise invalid_parameter_value using message = 'Choose an eligible profile.';
  end if;
end;
$$;

-- Run only in a privileged operational session after validating the application.
create function public.review_caa_professional_role(p_user_id uuid, p_approved boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_request comunica_react_private.professional_requests;
begin
  if p_approved is null then raise invalid_parameter_value; end if;
  perform 1 from public.caa_profiles where id = p_user_id for update;
  delete from comunica_react_private.professional_requests where user_id = p_user_id
    returning * into v_request;
  if not found then return false; end if;
  if p_approved then
    insert into comunica_react_private.account_roles (user_id, role) values (p_user_id, 'fonoaudiologo')
      on conflict do nothing;
    update public.caa_profiles set professional_category = v_request.category,
      professional_registration = v_request.registration, professional_validated_at = clock_timestamp()
      where id = p_user_id;
  end if;
  return true;
end;
$$;

create function comunica_react_private.invalidate_professional_validation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.professional_validated_at is not distinct from old.professional_validated_at
    and (new.professional_category is distinct from old.professional_category
      or new.professional_registration is distinct from old.professional_registration) then
    new.professional_validated_at := null;
  end if;
  return new;
end;
$$;
revoke all on function comunica_react_private.invalidate_professional_validation() from public, anon, authenticated;
create trigger caa_invalidate_professional_validation
  before update of professional_category, professional_registration on public.caa_profiles
  for each row execute function comunica_react_private.invalidate_professional_validation();

revoke all on function public.get_caa_account_options(), public.switch_caa_account_role(uuid,text),
  public.request_caa_account_role(uuid,text,text,text), public.review_caa_professional_role(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.get_caa_account_options(), public.switch_caa_account_role(uuid,text),
  public.request_caa_account_role(uuid,text,text,text) to authenticated;

create function comunica_react_private.register_initial_profession()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'fonoaudiologo' then
    update public.caa_profiles p set
      professional_category = u.raw_user_meta_data ->> 'professional_category',
      professional_registration = nullif(left(btrim(u.raw_user_meta_data ->> 'professional_registration'), 80), '')
      from auth.users u where u.id = new.id and u.raw_user_meta_data ->> 'professional_category' in (
        'Fonoaudiólogo', 'Terapeuta ocupacional', 'Fisioterapeuta', 'Psicólogo', 'Professor', 'Médico', 'Outro profissional');
  end if;
  return new;
end;
$$;
revoke all on function comunica_react_private.register_initial_profession() from public, anon, authenticated;
create trigger caa_register_initial_profession after insert on public.caa_profiles
  for each row execute function comunica_react_private.register_initial_profession();

create function public.complete_caa_profile_with_profession(p_nome text, p_consent boolean,
  p_expected_user_id uuid, p_category text, p_registration text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.complete_caa_profile('fonoaudiologo', p_nome, p_consent, p_expected_user_id);
  update public.caa_profiles set professional_category = p_category,
    professional_registration = nullif(btrim(p_registration), '') where id = p_expected_user_id;
end;
$$;
revoke all on function public.complete_caa_profile_with_profession(text,boolean,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_caa_profile_with_profession(text,boolean,uuid,text,text)
  to authenticated;

-- Existing links were authorized through the previous invitation workflow.
alter table public.caa_members add column approved_at timestamptz;
update public.caa_members set approved_at = created_at;
alter policy caa_members_select_participants on public.caa_members using (
  (professional_id = auth.uid() and approved_at is not null
    and comunica_react_private.has_role('fonoaudiologo'))
  or comunica_links_private.owns_child(crianca_id)
);

create or replace function comunica_links_private.is_member(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_react_private.has_role('fonoaudiologo') and exists (
    select from public.caa_members m where m.crianca_id = p_crianca_id
      and m.professional_id = auth.uid() and m.approved_at is not null
  );
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
  v_child uuid;
  v_approved_at timestamptz;
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
    -- Serialize with regeneration and ownership changes before locking the invitation.
    select i.crianca_id into v_child from public.caa_invitations i where i.code = p_code;
    select c.usuario_id into v_owner from public.criancas c where c.id = v_child for no key update;
    select i.* into v_invite from public.caa_invitations i
      where i.crianca_id = v_child and i.code = p_code for update;
    if found and not v_invite.is_used and v_invite.expires_at > pg_catalog.clock_timestamp() then
      if v_owner is not null and v_owner <> v_uid
        and comunica_react_private.account_has_role(v_owner, 'responsavel') then
        insert into public.caa_members (crianca_id, professional_id)
          values (v_invite.crianca_id, v_uid)
          on conflict on constraint caa_members_crianca_id_professional_id_key do nothing;
        select m.approved_at into v_approved_at from public.caa_members m
          where m.crianca_id = v_invite.crianca_id and m.professional_id = v_uid;
        update public.caa_invitations set is_used = true where id = v_invite.id;
        return query select case when v_approved_at is null then 'pending' else 'already_linked' end,
          case when v_approved_at is null then null::uuid else v_invite.crianca_id end, 0;
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

drop function public.list_caa_members(uuid);
create function public.list_caa_members(p_crianca_id uuid)
returns table (professional_id uuid, professional_name text, created_at timestamptz,
  board_access boolean, professional_category text, professional_validated boolean, approved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not comunica_links_private.owns_child(p_crianca_id) then raise insufficient_privilege; end if;
  return query select m.professional_id, p.nome, m.created_at, m.board_access,
    p.professional_category, p.professional_validated_at is not null, m.approved_at
    from public.caa_members m join public.caa_profiles p on p.id = m.professional_id
    where m.crianca_id = p_crianca_id order by p.nome, m.professional_id;
end;
$$;

create function public.approve_caa_professional_member(p_crianca_id uuid, p_professional_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.criancas c where c.id = p_crianca_id and c.usuario_id = auth.uid()
    for no key update;
  if not found or not comunica_links_private.owns_child(p_crianca_id) then raise insufficient_privilege; end if;
  update public.caa_members set approved_at = clock_timestamp()
    where crianca_id = p_crianca_id and professional_id = p_professional_id and approved_at is null;
  return found;
end;
$$;
create or replace function public.revoke_caa_member(p_crianca_id uuid, p_professional_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.criancas c where c.id = p_crianca_id and c.usuario_id = auth.uid()
    for no key update;
  if not found or not comunica_links_private.owns_child(p_crianca_id) then raise insufficient_privilege; end if;
  delete from public.caa_members m where m.crianca_id = p_crianca_id and m.professional_id = p_professional_id;
  return found;
end;
$$;
revoke all on function public.list_caa_members(uuid), public.approve_caa_professional_member(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.list_caa_members(uuid), public.approve_caa_professional_member(uuid,uuid)
  to authenticated;

commit;

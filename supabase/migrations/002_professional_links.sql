-- Comunica: professional access through single-use invitations.
-- Apply after 001_initial_schema.sql. This migration preserves comunicacoes.
-- Existing legacy caa_* relations require an explicit migration, never a DROP.
begin;

do $$
begin
  if pg_catalog.to_regclass('public.caa_invitations') is not null
    or pg_catalog.to_regclass('public.caa_members') is not null
    or pg_catalog.to_regclass('public.caa_events') is not null then
    raise exception 'CAA relation names already exist. Reconcile the existing schema before applying migration 002; no existing data was changed.';
  end if;
end;
$$;

create schema comunica_links_private;
revoke all on schema comunica_links_private from public, anon, authenticated;

create table public.caa_invitations (
  id uuid primary key default gen_random_uuid(),
  crianca_id uuid not null unique references public.criancas(id) on delete cascade,
  code text not null unique check (char_length(code) = 6 and code ~ '^[0-9]{6}$'),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  is_used boolean not null default false,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.caa_members (
  id uuid primary key default gen_random_uuid(),
  crianca_id uuid not null references public.criancas(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (crianca_id, professional_id)
);
create index caa_members_professional_child_idx
  on public.caa_members (professional_id, crianca_id);

create table comunica_links_private.redemption_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5)
);
revoke all on comunica_links_private.redemption_attempts from public, anon, authenticated;

alter table public.caa_invitations enable row level security;
alter table public.caa_members enable row level security;
revoke all on public.caa_invitations, public.caa_members from public, anon, authenticated;
grant select on public.caa_invitations, public.caa_members to authenticated;

create function comunica_links_private.owns_child(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.criancas c
    where c.id = p_crianca_id and c.usuario_id = (select auth.uid())
  );
$$;
create function comunica_links_private.is_member(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.caa_members m
    where m.crianca_id = p_crianca_id
      and m.professional_id = (select auth.uid())
  );
$$;
revoke all on function comunica_links_private.owns_child(uuid), comunica_links_private.is_member(uuid)
  from public, anon, authenticated;
grant usage on schema comunica_links_private to authenticated;
grant execute on function comunica_links_private.owns_child(uuid), comunica_links_private.is_member(uuid)
  to authenticated;

create policy caa_invitations_select_owner on public.caa_invitations
  for select to authenticated
  using (comunica_links_private.owns_child(crianca_id));
create policy caa_members_select_participants on public.caa_members
  for select to authenticated
  using (professional_id = (select auth.uid())
    or comunica_links_private.owns_child(crianca_id));
create policy criancas_select_linked_professional on public.criancas
  for select to authenticated
  using (comunica_links_private.is_member(id));
create policy comunicacoes_select_linked_professional on public.comunicacoes
  for select to authenticated
  using (comunica_links_private.is_member(crianca_id));

-- The existing historical data remains the single source of truth.
-- security_invoker makes the view obey the caller's table grants and RLS.
create view public.caa_events with (security_invoker = true) as
select id, usuario_id, crianca_id, pictograma_id, rotulo, categoria, created_at
from public.comunicacoes;
revoke all on public.caa_events from public, anon, authenticated;
grant select on public.caa_events to authenticated;

create function public.create_caa_invitation(p_crianca_id uuid)
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

create function public.redeem_caa_invitation(p_code text)
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
      if v_owner is not null and v_owner <> v_uid then
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

create function public.list_caa_members(p_crianca_id uuid)
returns table (professional_id uuid, professional_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Child access denied.';
  end if;
  return query select m.professional_id, p.nome, m.created_at
    from public.caa_members m join public.profiles p on p.id = m.professional_id
    where m.crianca_id = p_crianca_id order by p.nome, m.professional_id;
end;
$$;

create function public.revoke_caa_member(p_crianca_id uuid, p_professional_id uuid)
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

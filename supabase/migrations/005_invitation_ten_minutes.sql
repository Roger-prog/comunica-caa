-- Comunica - CAA: newly generated or regenerated invitations last 10 minutes.
-- Existing invitations retain their current expiry until regenerated.
begin;
set local lock_timeout = '5s';

alter table public.caa_invitations
  alter column expires_at set default (now() + interval '10 minutes');

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
        values (p_crianca_id, v_code, v_now + interval '10 minutes', false, v_now)
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

revoke all on function public.create_caa_invitation(uuid) from public, anon, authenticated;
grant execute on function public.create_caa_invitation(uuid) to authenticated;

commit;

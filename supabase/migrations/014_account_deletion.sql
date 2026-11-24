begin;
set local lock_timeout = '5s';

-- Replace the original RPC, which could cascade to patient profiles.
drop function if exists public.delete_own_caa_account(uuid);

create table comunica_react_private.account_deletion_reviews (
  user_id uuid primary key references public.caa_profiles(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  reason text not null check (reason in ('patient_care', 'storage'))
);
alter table comunica_react_private.account_deletion_reviews enable row level security;
revoke all on comunica_react_private.account_deletion_reviews from public, anon, authenticated;

-- Keep the asset and its patient link if the uploader's account is removed.
alter table comunica_board_private.symbol_images
  alter column uploaded_by drop not null,
  alter column guardian_id drop not null;

alter table comunica_board_private.access_changes
  alter column professional_id drop not null,
  drop constraint access_changes_professional_id_fkey,
  add constraint access_changes_professional_id_fkey
    foreign key (professional_id) references public.caa_profiles(id) on delete set null;

create function comunica_react_private.caa_account_deletion_plan(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', c.id, 'patient_name', c.nome,
    'successor_id', g.id, 'successor_name', g.nome) order by c.id), '[]'::jsonb)
  from public.criancas c
  left join lateral (
    select p.id, p.nome
    from public.caa_guardian_members m
    join public.caa_profiles p on p.id = m.guardian_id
    where m.crianca_id = c.id and m.can_manage_links and m.guardian_id <> p_user_id
      and comunica_react_private.account_has_role(m.guardian_id, 'responsavel')
    order by m.created_at, m.guardian_id
    limit 1
  ) g on true
  where c.usuario_id = p_user_id;
$$;

create function comunica_react_private.caa_account_deletion_review_reason(p_user_id uuid, p_plan jsonb)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select from jsonb_array_elements(p_plan) p where p->>'successor_id' is null)
      then 'patient_care'
    -- Storage objects are managed through the Storage API. Existing files that
    -- are owned by this account require an authorized handoff or cleanup.
    when exists (
      select from storage.objects o
      where o.owner_id = p_user_id::text or o.owner = p_user_id
    ) then 'storage'
  end;
$$;

create function comunica_react_private.caa_account_deletion_session_is_recent(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from auth.sessions s
    where s.id = (auth.jwt()->>'session_id')::uuid and s.user_id = p_user_id
      and s.created_at >= now() - interval '10 minutes'
  );
$$;

create function comunica_react_private.check_caa_account_deletion_identity(p_user_id uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or p_user_id is distinct from auth.uid() or not exists (
    select from auth.users u join public.caa_profiles p on p.id = u.id
    where u.id = p_user_id and u.email_confirmed_at is not null
  ) then raise insufficient_privilege; end if;
end;
$$;

create function public.preview_caa_account_deletion(p_expected_user_id uuid)
returns table (reauth_required boolean, review_reason text, review_requested_at timestamptz, patients jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform comunica_react_private.check_caa_account_deletion_identity(p_expected_user_id);
  patients := comunica_react_private.caa_account_deletion_plan(p_expected_user_id);
  reauth_required := not comunica_react_private.caa_account_deletion_session_is_recent(p_expected_user_id);
  review_reason := comunica_react_private.caa_account_deletion_review_reason(p_expected_user_id, patients);
  select r.requested_at into review_requested_at
    from comunica_react_private.account_deletion_reviews r where r.user_id = p_expected_user_id;
  return next;
end;
$$;

create function public.confirm_caa_account_deletion(p_expected_user_id uuid, p_confirmation text, p_expected_plan jsonb,
  p_expected_review_reason text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_plan jsonb;
  v_review_reason text;
  v_patient record;
begin
  perform comunica_react_private.check_caa_account_deletion_identity(p_expected_user_id);
  if p_confirmation is distinct from 'EXCLUIR' then raise invalid_parameter_value; end if;
  if not comunica_react_private.caa_account_deletion_session_is_recent(p_expected_user_id) then
    return 'reauth_required';
  end if;

  -- Prevent new patient ownership from being attached to this profile while
  -- deleting it, and serialize with invitations and board edits.
  perform 1 from public.caa_profiles where id = p_expected_user_id for update;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.criancas where usuario_id = p_expected_user_id order by id for update;
  v_plan := comunica_react_private.caa_account_deletion_plan(p_expected_user_id);
  if p_expected_plan is distinct from v_plan then return 'plan_changed'; end if;

  v_review_reason := comunica_react_private.caa_account_deletion_review_reason(p_expected_user_id, v_plan);
  if p_expected_review_reason is distinct from v_review_reason then return 'plan_changed'; end if;
  if v_review_reason is not null then
    insert into comunica_react_private.account_deletion_reviews (user_id, reason)
      values (p_expected_user_id, v_review_reason)
      on conflict (user_id) do update set reason = excluded.reason;
    return 'review_requested';
  end if;

  for v_patient in
    select * from jsonb_to_recordset(v_plan) as p(patient_id uuid, successor_id uuid)
  loop
    perform 1 from public.caa_profiles where id = v_patient.successor_id for key share;
    if not found then raise serialization_failure; end if;
    update public.criancas set usuario_id = v_patient.successor_id where id = v_patient.patient_id;
    update comunica_board_private.symbol_images set guardian_id = v_patient.successor_id
      where crianca_id = v_patient.patient_id;
    delete from public.caa_guardian_members where crianca_id = v_patient.patient_id
      and guardian_id = v_patient.successor_id;
    delete from public.caa_invitations where crianca_id = v_patient.patient_id;
  end loop;

  -- Keep photos and voice recordings associated with the patient. Clinical
  -- notes and custom symbols use ON DELETE SET NULL for author attribution.
  update comunica_board_private.symbol_images
    set guardian_id = null where guardian_id = p_expected_user_id;
  update comunica_board_private.symbol_images
    set state = 'retired', retired_at = clock_timestamp()
    where uploaded_by = p_expected_user_id and state = 'staged';
  update comunica_board_private.symbol_images set uploaded_by = null where uploaded_by = p_expected_user_id;
  update comunica_board_private.symbol_images set retired_by = null where retired_by = p_expected_user_id;
  delete from auth.users where id = p_expected_user_id;
  return 'deleted';
end;
$$;

revoke all on function comunica_react_private.caa_account_deletion_plan(uuid),
  comunica_react_private.caa_account_deletion_review_reason(uuid,jsonb),
  comunica_react_private.caa_account_deletion_session_is_recent(uuid),
  comunica_react_private.check_caa_account_deletion_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.preview_caa_account_deletion(uuid),
  public.confirm_caa_account_deletion(uuid,text,jsonb,text) from public, anon;
grant execute on function public.preview_caa_account_deletion(uuid),
  public.confirm_caa_account_deletion(uuid,text,jsonb,text) to authenticated;

notify pgrst, 'reload schema';
commit;

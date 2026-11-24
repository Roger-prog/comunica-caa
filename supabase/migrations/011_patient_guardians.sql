begin;
set local lock_timeout = '5s';

-- Ownership changes must carry the patient history to the new account.
alter table public.comunicacoes drop constraint comunicacoes_crianca_id_usuario_id_fkey;
alter table public.comunicacoes add constraint comunicacoes_crianca_id_usuario_id_fkey
  foreign key (crianca_id, usuario_id) references public.criancas(id, usuario_id)
  on update cascade on delete cascade not valid;
alter table public.comunicacoes validate constraint comunicacoes_crianca_id_usuario_id_fkey;

create table public.caa_guardian_members (
  crianca_id uuid not null references public.criancas(id) on delete cascade,
  guardian_id uuid not null references public.caa_profiles(id) on delete cascade,
  can_edit boolean not null default false,
  can_manage_links boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  primary key (crianca_id, guardian_id)
);
create index caa_guardian_members_guardian_idx on public.caa_guardian_members(guardian_id);

create table comunica_links_private.guardian_invitations (
  crianca_id uuid primary key references public.criancas(id) on delete cascade,
  target_email text not null,
  code text not null unique,
  created_by uuid not null references public.caa_profiles(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.caa_guardian_members enable row level security;
alter table comunica_links_private.guardian_invitations enable row level security;
revoke all on public.caa_guardian_members, comunica_links_private.guardian_invitations
  from public, anon, authenticated;

create function comunica_links_private.can_view_child_as_guardian(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_react_private.has_role('responsavel') and exists (
    select from public.criancas c where c.id = p_crianca_id and (c.usuario_id = auth.uid()
      or exists (select from public.caa_guardian_members m
        where m.crianca_id = c.id and m.guardian_id = auth.uid()))
  );
$$;

create function comunica_links_private.can_edit_child_as_guardian(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.owns_child(p_crianca_id) or (
    comunica_react_private.has_role('responsavel') and exists (
      select from public.caa_guardian_members m where m.crianca_id = p_crianca_id
        and m.guardian_id = auth.uid() and m.can_edit
    )
  );
$$;

create function comunica_links_private.can_manage_child_guardians(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.owns_child(p_crianca_id) or (
    comunica_react_private.has_role('responsavel') and exists (
      select from public.caa_guardian_members m where m.crianca_id = p_crianca_id
        and m.guardian_id = auth.uid() and m.can_manage_links
    )
  );
$$;

create function comunica_links_private.guardian_event_owner_matches(p_crianca_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not comunica_links_private.can_edit_child_as_guardian(p_crianca_id) then return false; end if;
  perform 1 from public.criancas c where c.id = p_crianca_id and c.usuario_id = p_owner for key share;
  return found and comunica_links_private.can_edit_child_as_guardian(p_crianca_id);
end;
$$;

create function comunica_links_private.can_delete_child(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.owns_child(p_crianca_id) and not exists (
    select from public.caa_guardian_members m where m.crianca_id = p_crianca_id
  );
$$;

revoke all on function comunica_links_private.can_view_child_as_guardian(uuid),
  comunica_links_private.can_edit_child_as_guardian(uuid), comunica_links_private.can_manage_child_guardians(uuid),
  comunica_links_private.guardian_event_owner_matches(uuid,uuid), comunica_links_private.can_delete_child(uuid)
  from public, anon, authenticated;
grant execute on function comunica_links_private.can_view_child_as_guardian(uuid),
  comunica_links_private.guardian_event_owner_matches(uuid,uuid), comunica_links_private.can_delete_child(uuid)
  to authenticated;

alter policy criancas_select_own on public.criancas
  using (comunica_links_private.can_view_child_as_guardian(id));
alter policy criancas_delete_own on public.criancas
  using (comunica_links_private.can_delete_child(id));
alter policy comunicacoes_select_own on public.comunicacoes
  using (comunica_links_private.can_view_child_as_guardian(crianca_id));
alter policy comunicacoes_insert_own on public.comunicacoes
  with check (
    comunica_links_private.guardian_event_owner_matches(crianca_id, usuario_id)
    and not exists (
      select from public.caa_board_settings b where b.crianca_id = comunicacoes.crianca_id
        and b.settings->'historyRecording' = 'false'::jsonb
    )
    and (symbol_source is distinct from 'custom' or exists (
      select from public.caa_custom_symbols s where s.crianca_id = comunicacoes.crianca_id
        and s.id::text = comunicacoes.pictograma_id
    ))
  );

create function comunica_links_private.prevent_shared_patient_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select from public.caa_guardian_members where crianca_id = old.id) then
    raise foreign_key_violation using message = 'Shared patients require ownership transfer.';
  end if;
  return old;
end;
$$;
revoke all on function comunica_links_private.prevent_shared_patient_deletion() from public, anon, authenticated;
create trigger caa_prevent_shared_patient_deletion before delete on public.criancas
  for each row execute function comunica_links_private.prevent_shared_patient_deletion();

create function public.get_caa_guardian_access(p_crianca_id uuid)
returns table (is_owner boolean, can_edit boolean, can_manage_links boolean)
language sql stable security definer set search_path = '' as $$
  select comunica_links_private.owns_child(p_crianca_id),
    comunica_links_private.can_edit_child_as_guardian(p_crianca_id),
    comunica_links_private.can_manage_child_guardians(p_crianca_id)
  where comunica_links_private.can_view_child_as_guardian(p_crianca_id);
$$;

create function public.list_caa_guardians(p_crianca_id uuid)
returns table (guardian_id uuid, guardian_name text, is_owner boolean, can_edit boolean,
  can_manage_links boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not comunica_links_private.can_view_child_as_guardian(p_crianca_id) then
    raise insufficient_privilege;
  end if;
  return query
    select p.id, p.nome, true, true, true, c.created_at
      from public.criancas c join public.caa_profiles p on p.id = c.usuario_id where c.id = p_crianca_id
    union all
    select p.id, p.nome, false, m.can_edit, m.can_manage_links, m.created_at
      from public.caa_guardian_members m join public.caa_profiles p on p.id = m.guardian_id
      where m.crianca_id = p_crianca_id
    order by 3 desc, 6, 1;
end;
$$;

create function public.create_caa_guardian_invitation(p_crianca_id uuid, p_email text)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email));
begin
  perform 1 from public.criancas where id = p_crianca_id for update;
  if not found or not comunica_links_private.can_manage_child_guardians(p_crianca_id) then
    raise insufficient_privilege;
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise invalid_parameter_value;
  end if;
  return query insert into comunica_links_private.guardian_invitations as i
    (crianca_id, target_email, code, created_by, expires_at)
    values (p_crianca_id, v_email, replace(gen_random_uuid()::text, '-', ''), auth.uid(),
      clock_timestamp() + interval '1 hour')
    on conflict (crianca_id) do update set target_email = excluded.target_email, code = excluded.code,
      created_by = excluded.created_by, expires_at = excluded.expires_at
    returning i.code, i.expires_at;
end;
$$;

create function public.redeem_caa_guardian_invitation(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_child uuid;
  v_owner uuid;
  v_uid uuid := auth.uid();
  v_email text;
  v_code text := lower(btrim(p_code));
begin
  if not comunica_react_private.has_role('responsavel') then raise insufficient_privilege; end if;
  if v_code is null or v_code !~ '^[0-9a-f]{32}$' then return null; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  select i.crianca_id into v_child from comunica_links_private.guardian_invitations i
    where i.code = v_code and i.target_email = v_email and i.expires_at > clock_timestamp();
  if not found then return null; end if;
  select c.usuario_id into v_owner from public.criancas c where c.id = v_child for update;
  if not found or v_owner = v_uid then return null; end if;
  delete from comunica_links_private.guardian_invitations i where i.crianca_id = v_child
    and i.code = v_code and i.target_email = v_email and i.expires_at > clock_timestamp()
    and (i.created_by = v_owner or exists (
      select from public.caa_guardian_members m where m.crianca_id = v_child
        and m.guardian_id = i.created_by and m.can_manage_links
    ));
  if not found then return null; end if;
  insert into public.caa_guardian_members (crianca_id, guardian_id) values (v_child, v_uid)
    on conflict do nothing;
  return v_child;
end;
$$;

create function public.set_caa_guardian_permissions(p_crianca_id uuid, p_guardian_id uuid,
  p_can_edit boolean, p_can_manage_links boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.criancas where id = p_crianca_id for update;
  if not found or not comunica_links_private.owns_child(p_crianca_id) then raise insufficient_privilege; end if;
  update public.caa_guardian_members set can_edit = p_can_edit, can_manage_links = p_can_manage_links
    where crianca_id = p_crianca_id and guardian_id = p_guardian_id;
  return found;
end;
$$;

create function public.revoke_caa_guardian(p_crianca_id uuid, p_guardian_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_is_owner boolean;
begin
  perform 1 from public.criancas where id = p_crianca_id for update;
  if not found then raise insufficient_privilege; end if;
  v_is_owner := comunica_links_private.owns_child(p_crianca_id);
  if not comunica_links_private.can_manage_child_guardians(p_crianca_id) then raise insufficient_privilege; end if;
  delete from public.caa_guardian_members where crianca_id = p_crianca_id and guardian_id = p_guardian_id
    and (v_is_owner or not can_manage_links);
  return found;
end;
$$;

create function comunica_board_private.retire_guardian_uploads()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (old.can_edit and not new.can_edit) then
    update comunica_board_private.symbol_images set state = 'retired', retired_at = clock_timestamp()
      where crianca_id = old.crianca_id and uploaded_by = old.guardian_id and state = 'staged';
  end if;
  if tg_op = 'DELETE' or (old.can_manage_links and not new.can_manage_links) then
    delete from comunica_links_private.guardian_invitations
      where crianca_id = old.crianca_id and created_by = old.guardian_id;
  end if;
  return null;
end;
$$;
revoke all on function comunica_board_private.retire_guardian_uploads() from public, anon, authenticated;
create trigger caa_retire_guardian_uploads after delete or update on public.caa_guardian_members
  for each row execute function comunica_board_private.retire_guardian_uploads();

create or replace function comunica_board_private.can_view(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.can_view_child_as_guardian(p_crianca_id) or (
    comunica_links_private.is_member(p_crianca_id) and exists (
      select from public.caa_members m where m.crianca_id = p_crianca_id
        and m.professional_id = auth.uid() and m.board_access
    )
  );
$$;

create function comunica_board_private.can_edit(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.can_edit_child_as_guardian(p_crianca_id) or (
    comunica_links_private.is_member(p_crianca_id) and exists (
      select from public.caa_members m where m.crianca_id = p_crianca_id
        and m.professional_id = auth.uid() and m.board_access
    )
  );
$$;
revoke all on function comunica_board_private.can_edit(uuid) from public, anon, authenticated;

create or replace function comunica_board_private.lock_board(p_crianca_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_guardian uuid;
begin
  if not comunica_board_private.can_edit(p_crianca_id) then raise insufficient_privilege; end if;
  select c.usuario_id into v_guardian from public.criancas c where c.id = p_crianca_id for no key update;
  if not found then raise insufficient_privilege; end if;
  if comunica_links_private.can_edit_child_as_guardian(p_crianca_id) then return v_guardian; end if;
  if not comunica_react_private.has_role('fonoaudiologo') then raise insufficient_privilege; end if;
  perform 1 from public.caa_members m where m.crianca_id = p_crianca_id and m.professional_id = auth.uid()
    and m.approved_at is not null and m.board_access for share;
  if not found then raise insufficient_privilege; end if;
  return v_guardian;
end;
$$;

create or replace function comunica_board_private.can_upload_image(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from comunica_board_private.symbol_images i where i.path = p_path and i.uploaded_by = auth.uid()
      and i.state = 'staged' and i.expires_at > statement_timestamp() and comunica_board_private.can_edit(i.crianca_id)
  );
$$;

create or replace function public.set_caa_board_member_access(p_crianca_id uuid, p_professional_id uuid, p_allowed boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not comunica_links_private.owns_child(p_crianca_id) then raise insufficient_privilege; end if;
  if p_allowed is null then raise invalid_parameter_value; end if;
  perform comunica_board_private.lock_board(p_crianca_id);
  update public.caa_members set board_access = p_allowed where crianca_id = p_crianca_id
    and professional_id = p_professional_id and approved_at is not null;
  if not found then raise insufficient_privilege; end if;
  return p_allowed;
end;
$$;

revoke all on function public.get_caa_guardian_access(uuid), public.list_caa_guardians(uuid),
  public.create_caa_guardian_invitation(uuid,text), public.redeem_caa_guardian_invitation(text),
  public.set_caa_guardian_permissions(uuid,uuid,boolean,boolean), public.revoke_caa_guardian(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_caa_guardian_access(uuid), public.list_caa_guardians(uuid),
  public.create_caa_guardian_invitation(uuid,text), public.redeem_caa_guardian_invitation(text),
  public.set_caa_guardian_permissions(uuid,uuid,boolean,boolean), public.revoke_caa_guardian(uuid,uuid)
  to authenticated;
revoke execute on function public.delete_own_caa_account(uuid) from public, anon, authenticated;

commit;

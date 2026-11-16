-- Per-patient board settings and symbols. Patient links continue to be managed
-- exclusively by the existing invitation and revocation RPCs.
begin;
set local lock_timeout = '5s';

create schema comunica_board_private;
revoke all on schema comunica_board_private from public, anon, authenticated;
grant usage on schema comunica_board_private to authenticated;

-- Existing invitations and links only authorize consulting history and reports.
-- Board editing (including private photos) always requires explicit opt-in.
alter table public.caa_members add column board_access boolean not null default false;

create table comunica_board_private.access_changes (
  id bigint generated always as identity primary key,
  crianca_id uuid not null references public.criancas(id) on delete cascade,
  professional_id uuid not null references public.caa_profiles(id) on delete cascade,
  actor_id uuid references public.caa_profiles(id) on delete set null,
  action text not null check (action in ('link_created', 'link_removed', 'board_enabled', 'board_disabled')),
  created_at timestamptz not null default clock_timestamp()
);
create index caa_access_changes_child_idx on comunica_board_private.access_changes(crianca_id, created_at);
create index caa_access_changes_professional_idx on comunica_board_private.access_changes(professional_id);
create index caa_access_changes_actor_idx on comunica_board_private.access_changes(actor_id) where actor_id is not null;
alter table comunica_board_private.access_changes enable row level security;
revoke all on comunica_board_private.access_changes from public, anon, authenticated;
insert into comunica_board_private.access_changes (crianca_id, professional_id, action, created_at)
  select crianca_id, professional_id, 'link_created', created_at from public.caa_members;

create function comunica_board_private.record_access_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row public.caa_members;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'link_removed';
  elsif tg_op = 'INSERT' then
    v_row := new;
    v_action := 'link_created';
  elsif old.board_access is distinct from new.board_access then
    v_row := new;
    v_action := case when new.board_access then 'board_enabled' else 'board_disabled' end;
  else
    return null;
  end if;

  -- Cascades erase per-patient history as part of account/patient deletion.
  insert into comunica_board_private.access_changes (crianca_id, professional_id, actor_id, action)
    select c.id, p.id, a.id, v_action
    from public.criancas c cross join public.caa_profiles p
    left join public.caa_profiles a on a.id = auth.uid()
    where c.id = v_row.crianca_id and p.id = v_row.professional_id;

  if v_action in ('link_removed', 'board_disabled') then
    update comunica_board_private.symbol_images
      set state = 'retired', retired_at = clock_timestamp(), retired_by = auth.uid()
      where crianca_id = v_row.crianca_id and uploaded_by = v_row.professional_id and state = 'staged';
  end if;
  return null;
end;
$$;

create trigger caa_audit_member_access
  after insert or update of board_access or delete on public.caa_members
  for each row execute function comunica_board_private.record_access_change();

create function comunica_board_private.can_view(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.owns_child(p_crianca_id)
    or (comunica_react_private.has_role('fonoaudiologo') and exists (
      select 1 from public.caa_members m
      where m.crianca_id = p_crianca_id and m.professional_id = auth.uid() and m.board_access
    ));
$$;

create function public.has_caa_board_access(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_board_private.can_view(p_crianca_id);
$$;

create function comunica_board_private.lock_board(p_crianca_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_guardian uuid;
begin
  if not comunica_board_private.can_view(p_crianca_id) then
    raise insufficient_privilege using message = 'Board access denied.';
  end if;

  -- Serialize mutations for this patient and coordinate with patient deletion.
  select c.usuario_id into v_guardian
    from public.criancas c where c.id = p_crianca_id for no key update;
  if not found then raise insufficient_privilege using message = 'Board access denied.'; end if;

  if comunica_links_private.owns_child(p_crianca_id) then return v_guardian; end if;

  if not comunica_react_private.has_role('fonoaudiologo') then
    raise insufficient_privilege using message = 'Board access denied.';
  end if;

  -- Hold the live link while a mutation commits, so revocation and a concurrent
  -- professional edit cannot both take effect in the opposite order.
  perform 1 from public.caa_members m
    where m.crianca_id = p_crianca_id and m.professional_id = auth.uid() and m.board_access
    for share;
  if not found then raise insufficient_privilege using message = 'Board access denied.'; end if;

  return v_guardian;
end;
$$;

create function public.set_caa_board_member_access(
  p_crianca_id uuid, p_professional_id uuid, p_allowed boolean
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Board access denied.';
  end if;
  if p_allowed is null then raise invalid_parameter_value using message = 'Permission is required.'; end if;

  perform comunica_board_private.lock_board(p_crianca_id);
  update public.caa_members set board_access = p_allowed
    where crianca_id = p_crianca_id and professional_id = p_professional_id;
  if not found then raise insufficient_privilege using message = 'Member access denied.'; end if;
  return p_allowed;
end;
$$;

create table public.caa_catalog_symbols (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  speech_text text not null check (char_length(btrim(speech_text)) between 1 and 150),
  category text not null,
  categories text[] not null check (cardinality(categories) between 1 and 20),
  source_categories text[] not null default '{}',
  source text not null check (source in ('pdf', 'telemedicina', 'legado')),
  arasaac_id integer check (arasaac_id > 0),
  image_url text,
  review_status text not null check (review_status in ('verified', 'pending')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (category = any(categories)),
  check (
    (review_status = 'pending' and arasaac_id is null and image_url is null)
    or (review_status = 'verified' and arasaac_id is not null
      and image_url is not null and image_url =
        'https://static.arasaac.org/pictograms/' || arasaac_id || '/' || arasaac_id || '_500.png')
  )
);

create table public.caa_board_settings (
  crianca_id uuid primary key references public.criancas(id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 16384),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

-- Kept privately after child deletion only to allow cleanup of unreachable files.
-- The random path never includes a name, file name, or medical information.
create table comunica_board_private.symbol_images (
  path text primary key,
  crianca_id uuid not null,
  guardian_id uuid not null,
  uploaded_by uuid not null,
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  retired_at timestamptz,
  retired_by uuid,
  state text not null default 'staged' check (state in ('staged', 'attached', 'retired'))
);
create index caa_symbol_images_cleanup_idx on comunica_board_private.symbol_images(crianca_id, state, expires_at);

create table public.caa_custom_symbols (
  id uuid primary key default gen_random_uuid(),
  crianca_id uuid not null references public.criancas(id) on delete cascade,
  created_by uuid references public.caa_profiles(id) on delete set null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  speech_text text not null check (char_length(btrim(speech_text)) between 1 and 150),
  categories text[] not null check (cardinality(categories) between 1 and 8),
  arasaac_id integer check (arasaac_id > 0),
  image_path text unique references comunica_board_private.symbol_images(path),
  source text generated always as (case when image_path is null then 'arasaac' else 'personalizado' end) stored,
  hidden boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(arasaac_id, image_path) = 1)
);
create index caa_custom_symbols_child_idx on public.caa_custom_symbols(crianca_id, id);

create table public.caa_catalog_overrides (
  crianca_id uuid not null references public.criancas(id) on delete cascade,
  symbol_id text not null references public.caa_catalog_symbols(id) on delete cascade,
  arasaac_id integer not null check (arasaac_id > 0),
  reviewed_by uuid references public.caa_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (crianca_id, symbol_id)
);

alter table public.caa_catalog_symbols enable row level security;
alter table public.caa_board_settings enable row level security;
alter table public.caa_custom_symbols enable row level security;
alter table public.caa_catalog_overrides enable row level security;
alter table comunica_board_private.symbol_images enable row level security;
revoke all on public.caa_catalog_symbols, public.caa_board_settings, public.caa_custom_symbols,
  public.caa_catalog_overrides, comunica_board_private.symbol_images from public, anon, authenticated;
grant select on public.caa_catalog_symbols, public.caa_board_settings, public.caa_custom_symbols,
  public.caa_catalog_overrides to authenticated;

create policy caa_catalog_confirmed_roles on public.caa_catalog_symbols for select to authenticated
  using ((select comunica_react_private.has_role('responsavel')) or
    (select comunica_react_private.has_role('fonoaudiologo')));
create policy caa_board_settings_read on public.caa_board_settings for select to authenticated
  using (comunica_board_private.can_view(crianca_id));
create policy caa_custom_symbols_read on public.caa_custom_symbols for select to authenticated
  using (comunica_board_private.can_view(crianca_id));
create policy caa_catalog_overrides_read on public.caa_catalog_overrides for select to authenticated
  using (comunica_board_private.can_view(crianca_id));

create function public.save_caa_board_settings(
  p_crianca_id uuid, p_settings jsonb, p_expected_version integer
)
returns setof public.caa_board_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_version integer;
begin
  perform comunica_board_private.lock_board(p_crianca_id);
  select b.version into v_version from public.caa_board_settings b where b.crianca_id = p_crianca_id;
  if coalesce(v_version, 0) is distinct from p_expected_version then
    raise sqlstate '40001' using message = 'Board settings changed. Reload before retrying.';
  end if;

  return query
    insert into public.caa_board_settings as b (crianca_id, settings)
    values (p_crianca_id, p_settings)
    on conflict (crianca_id) do update
      set settings = excluded.settings, version = b.version + 1, updated_at = clock_timestamp()
    returning b.*;
end;
$$;

create function public.save_caa_catalog_override(
  p_crianca_id uuid, p_symbol_id text, p_arasaac_id integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform comunica_board_private.lock_board(p_crianca_id);
  if p_arasaac_id is null then
    delete from public.caa_catalog_overrides
      where crianca_id = p_crianca_id and symbol_id = p_symbol_id;
    return;
  end if;

  insert into public.caa_catalog_overrides (crianca_id, symbol_id, arasaac_id, reviewed_by)
  values (p_crianca_id, p_symbol_id, p_arasaac_id, auth.uid())
  on conflict (crianca_id, symbol_id) do update
    set arasaac_id = excluded.arasaac_id, reviewed_by = excluded.reviewed_by, updated_at = clock_timestamp();
end;
$$;

create function public.reserve_caa_symbol_image(p_crianca_id uuid, p_authorized boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_guardian uuid;
  v_path text;
begin
  v_guardian := comunica_board_private.lock_board(p_crianca_id);
  if p_authorized is distinct from true then
    raise invalid_parameter_value using message = 'Photo authorization is required.';
  end if;
  -- Older completed cleanup records contain identifiers but no file. Prune
  -- them in small batches after allowing in-flight uploads time to settle.
  delete from comunica_board_private.symbol_images where path in (
    select i.path from comunica_board_private.symbol_images i
    where i.crianca_id = p_crianca_id and i.state <> 'attached'
      and coalesce(i.retired_at, i.expires_at) <= now() - interval '24 hours'
      and not exists (select 1 from storage.objects o where o.bucket_id = 'caa-symbol-images' and o.name = i.path)
    order by i.expires_at limit 50
  );
  if (select count(*) from comunica_board_private.symbol_images
    where crianca_id = p_crianca_id and state = 'staged' and expires_at > now()) >= 20 then
    raise program_limit_exceeded using message = 'Too many active photo uploads.';
  end if;
  if (select count(*) from comunica_board_private.symbol_images
    where crianca_id = p_crianca_id and authorized_at > now() - interval '1 hour') >= 60 then
    raise program_limit_exceeded using message = 'Too many recent photo uploads.';
  end if;

  v_path := p_crianca_id::text || '/' || gen_random_uuid()::text;
  insert into comunica_board_private.symbol_images (path, crianca_id, guardian_id, uploaded_by)
    values (v_path, p_crianca_id, v_guardian, auth.uid());
  return v_path;
end;
$$;

create function public.discard_caa_symbol_image(p_crianca_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform comunica_board_private.lock_board(p_crianca_id);
  update comunica_board_private.symbol_images
    set state = 'retired', retired_at = clock_timestamp(), retired_by = auth.uid()
    where path = p_path and crianca_id = p_crianca_id and state = 'staged'
      and (uploaded_by = auth.uid() or guardian_id = auth.uid());
end;
$$;

create function comunica_board_private.can_upload_image(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from comunica_board_private.symbol_images i
    where i.path = p_path and i.uploaded_by = auth.uid()
      and i.state = 'staged' and i.expires_at > statement_timestamp()
      and comunica_board_private.can_view(i.crianca_id)
  );
$$;

create function comunica_board_private.can_clean_image(
  p_crianca_id uuid, p_guardian_id uuid, p_uploaded_by uuid, p_retired_by uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select (p_guardian_id = auth.uid() and comunica_react_private.has_role('responsavel'))
    or ((p_uploaded_by = auth.uid() or p_retired_by = auth.uid())
      and comunica_board_private.can_view(p_crianca_id));
$$;

create function comunica_board_private.can_remove_image(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from comunica_board_private.symbol_images i
    where i.path = p_path
      and (i.state = 'retired' or (i.state = 'staged' and i.expires_at <= statement_timestamp()))
      and comunica_board_private.can_clean_image(i.crianca_id, i.guardian_id, i.uploaded_by, i.retired_by)
  );
$$;

create function public.list_caa_symbol_image_cleanup(p_crianca_id uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array(
    select i.path from comunica_board_private.symbol_images i
    join storage.objects o on o.bucket_id = 'caa-symbol-images' and o.name = i.path
    where i.crianca_id = p_crianca_id
      and (i.state = 'retired' or (i.state = 'staged' and i.expires_at <= statement_timestamp()))
      and comunica_board_private.can_clean_image(i.crianca_id, i.guardian_id, i.uploaded_by, i.retired_by)
    order by i.authorized_at, i.path limit 50
  );
$$;

create function public.save_caa_custom_symbol(
  p_crianca_id uuid, p_id uuid, p_label text, p_speech_text text, p_categories text[],
  p_arasaac_id integer, p_image_path text, p_hidden boolean, p_expected_version integer
)
returns table (symbol jsonb, retired_path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.caa_custom_symbols;
  v_result public.caa_custom_symbols;
  v_retired_path text;
begin
  perform comunica_board_private.lock_board(p_crianca_id);
  if p_categories is null or cardinality(p_categories) not between 1 and 8
    or exists (select 1 from unnest(p_categories) as c(id) where id is null or id !~ '^[a-z0-9][a-z0-9_-]{0,79}$')
    or (select count(distinct id) from unnest(p_categories) as c(id)) <> cardinality(p_categories) then
    raise invalid_parameter_value using message = 'Choose valid, distinct board categories.';
  end if;

  if p_id is null then
    if p_expected_version is distinct from 0 then
      raise sqlstate '40001' using message = 'Symbol changed. Reload before retrying.';
    end if;
    if (select count(*) from public.caa_custom_symbols s where s.crianca_id = p_crianca_id) >= 250 then
      raise program_limit_exceeded using message = 'Too many custom symbols.';
    end if;
  else
    select s.* into v_current from public.caa_custom_symbols s
      where s.id = p_id and s.crianca_id = p_crianca_id;
    if not found then raise insufficient_privilege using message = 'Symbol access denied.'; end if;
    if v_current.version is distinct from p_expected_version then
      raise sqlstate '40001' using message = 'Symbol changed. Reload before retrying.';
    end if;
  end if;

  if p_image_path is not null and p_image_path is distinct from v_current.image_path then
    update comunica_board_private.symbol_images i set state = 'attached'
      where i.path = p_image_path and i.crianca_id = p_crianca_id and i.uploaded_by = auth.uid()
        and i.state = 'staged' and i.expires_at > clock_timestamp()
        and exists (
          select 1 from storage.objects o where o.bucket_id = 'caa-symbol-images' and o.name = i.path
            and o.metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
            and case when o.metadata->>'size' ~ '^[0-9]{1,7}$'
              then (o.metadata->>'size')::integer between 1 and 2097152 else false end
        );
    if not found then raise invalid_parameter_value using message = 'Upload a valid, authorized image.'; end if;
  end if;

  if p_id is null then
    insert into public.caa_custom_symbols (
      crianca_id, created_by, label, speech_text, categories, arasaac_id, image_path, hidden
    ) values (
      p_crianca_id, auth.uid(), btrim(p_label), btrim(p_speech_text), p_categories,
      p_arasaac_id, p_image_path, p_hidden
    ) returning * into v_result;
  else
    update public.caa_custom_symbols s set label = btrim(p_label), speech_text = btrim(p_speech_text),
      categories = p_categories, arasaac_id = p_arasaac_id, image_path = p_image_path,
      hidden = p_hidden, version = s.version + 1, updated_at = clock_timestamp()
      where s.id = p_id and s.crianca_id = p_crianca_id returning s.* into v_result;
  end if;

  if v_current.image_path is not null and v_current.image_path is distinct from p_image_path then
    update comunica_board_private.symbol_images set state = 'retired', retired_at = clock_timestamp(), retired_by = auth.uid()
      where path = v_current.image_path;
    v_retired_path := v_current.image_path;
  end if;

  return query select to_jsonb(v_result), v_retired_path;
end;
$$;

create function public.delete_caa_custom_symbol(
  p_crianca_id uuid, p_id uuid, p_expected_version integer
)
returns table (retired_path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.caa_custom_symbols;
begin
  perform comunica_board_private.lock_board(p_crianca_id);
  select s.* into v_current from public.caa_custom_symbols s
    where s.id = p_id and s.crianca_id = p_crianca_id;
  if not found or (v_current.created_by is distinct from auth.uid()
    and not comunica_links_private.owns_child(p_crianca_id)) then
    raise insufficient_privilege using message = 'Symbol access denied.';
  end if;
  if v_current.version is distinct from p_expected_version then
    raise sqlstate '40001' using message = 'Symbol changed. Reload before retrying.';
  end if;

  delete from public.caa_custom_symbols where id = p_id and crianca_id = p_crianca_id;
  if v_current.image_path is not null then
    update comunica_board_private.symbol_images set state = 'retired', retired_at = clock_timestamp(), retired_by = auth.uid()
      where path = v_current.image_path;
  end if;
  return query select v_current.image_path;
end;
$$;

create function comunica_board_private.retire_patient_images()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update comunica_board_private.symbol_images set state = 'retired', retired_at = clock_timestamp()
    where crianca_id = old.id and state <> 'retired';
  return old;
end;
$$;

create trigger caa_retire_deleted_patient_images
  before delete on public.criancas for each row
  execute function comunica_board_private.retire_patient_images();

-- Supabase manages the storage schema. Fail closed if the service does not
-- provide operation-aware access control or the bucket is already in use.
do $$
begin
  if to_regprocedure('storage.allow_any_operation(text[])') is null
    or not exists (select 1 from pg_catalog.pg_class where oid = 'storage.objects'::regclass and relrowsecurity) then
    raise feature_not_supported using message = 'Supabase Storage operation-aware RLS is required.';
  end if;
end;
$$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('caa-symbol-images', 'caa-symbol-images', false, 2097152, array['image/jpeg','image/png','image/webp']);

-- Restrictive policies also guard against broader policies for other buckets.
create policy caa_symbol_storage_no_anonymous on storage.objects as restrictive for all to anon
  using (bucket_id <> 'caa-symbol-images') with check (bucket_id <> 'caa-symbol-images');
create policy caa_symbol_storage_no_bucket_changes on storage.buckets as restrictive for update to anon, authenticated
  using (id <> 'caa-symbol-images') with check (id <> 'caa-symbol-images');
create policy caa_symbol_storage_no_bucket_delete on storage.buckets as restrictive for delete to anon, authenticated
  using (id <> 'caa-symbol-images');
create policy caa_symbol_storage_no_overwrite on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'caa-symbol-images') with check (bucket_id <> 'caa-symbol-images');

create policy caa_symbol_storage_guard_upload on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'caa-symbol-images' or (
    storage.allow_any_operation(array['object.upload'])
      and comunica_board_private.can_upload_image(name)
  ));
create policy caa_symbol_storage_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'caa-symbol-images');

-- The app's authenticated photo route reads the current symbol through RLS and
-- then avoids the public and JWT Storage caches with a server-only fetch.
-- SELECT here is needed only for the Storage API's physical deletion.
create policy caa_symbol_storage_guard_read on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'caa-symbol-images' or (
    storage.allow_any_operation(array['object.delete', 'object.delete_many'])
      and comunica_board_private.can_remove_image(name)
  ));
create policy caa_symbol_storage_select_to_delete on storage.objects for select to authenticated
  using (bucket_id = 'caa-symbol-images');
create policy caa_symbol_storage_guard_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'caa-symbol-images' or (
    storage.allow_any_operation(array['object.delete', 'object.delete_many'])
      and comunica_board_private.can_remove_image(name)
  ));
create policy caa_symbol_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'caa-symbol-images');

revoke all on all functions in schema comunica_board_private from public, anon, authenticated;
grant execute on function comunica_board_private.can_view(uuid),
  comunica_board_private.can_upload_image(text), comunica_board_private.can_remove_image(text)
  to authenticated;

revoke all on function public.has_caa_board_access(uuid), public.set_caa_board_member_access(uuid,uuid,boolean),
  public.save_caa_board_settings(uuid,jsonb,integer),
  public.save_caa_catalog_override(uuid,text,integer), public.reserve_caa_symbol_image(uuid,boolean),
  public.discard_caa_symbol_image(uuid,text), public.list_caa_symbol_image_cleanup(uuid),
  public.save_caa_custom_symbol(uuid,uuid,text,text,text[],integer,text,boolean,integer),
  public.delete_caa_custom_symbol(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.has_caa_board_access(uuid), public.set_caa_board_member_access(uuid,uuid,boolean),
  public.save_caa_board_settings(uuid,jsonb,integer),
  public.save_caa_catalog_override(uuid,text,integer), public.reserve_caa_symbol_image(uuid,boolean),
  public.discard_caa_symbol_image(uuid,text), public.list_caa_symbol_image_cleanup(uuid),
  public.save_caa_custom_symbol(uuid,uuid,text,text,text[],integer,text,boolean,integer),
  public.delete_caa_custom_symbol(uuid,uuid,integer) to authenticated;

commit;

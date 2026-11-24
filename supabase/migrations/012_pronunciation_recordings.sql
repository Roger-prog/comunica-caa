-- Voice recordings and review notes are private database data. Only small,
-- authenticated clips are returned, and every playback rechecks the link.
begin;

create schema comunica_pronunciation_private;
revoke all on schema comunica_pronunciation_private from public, anon, authenticated;

create table comunica_pronunciation_private.settings (
  crianca_id uuid primary key references public.criancas(id) on delete cascade,
  retention_days integer not null check (retention_days in (30, 90, 180, 365))
);

create table comunica_pronunciation_private.professional_access (
  crianca_id uuid not null,
  professional_id uuid not null,
  can_observe boolean not null default false,
  primary key (crianca_id, professional_id),
  foreign key (crianca_id, professional_id)
    references public.caa_members(crianca_id, professional_id) on delete cascade
);

create table comunica_pronunciation_private.recordings (
  id uuid primary key,
  crianca_id uuid not null references public.criancas(id) on delete cascade,
  captured_by uuid references public.caa_profiles(id) on delete set null,
  practice text not null check (char_length(practice) between 1 and 160),
  mime_type text not null check (mime_type in ('audio/webm', 'audio/mp4', 'audio/ogg')),
  audio bytea not null check (octet_length(audio) between 12 and 2097152),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index pronunciation_recordings_patient_time
  on comunica_pronunciation_private.recordings (crianca_id, created_at desc, id desc);
create index pronunciation_recordings_expires
  on comunica_pronunciation_private.recordings (expires_at);

create table comunica_pronunciation_private.notes (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references comunica_pronunciation_private.recordings(id) on delete cascade,
  author_id uuid references public.caa_profiles(id) on delete set null,
  observation text not null check (char_length(observation) between 1 and 2000),
  updated_at timestamptz not null default clock_timestamp(),
  unique (recording_id, author_id)
);

alter table comunica_pronunciation_private.settings enable row level security;
alter table comunica_pronunciation_private.professional_access enable row level security;
alter table comunica_pronunciation_private.recordings enable row level security;
alter table comunica_pronunciation_private.notes enable row level security;
revoke all on all tables in schema comunica_pronunciation_private from public, anon, authenticated;

create function comunica_pronunciation_private.professional_can_access(
  p_crianca_id uuid, p_observe boolean
)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.is_member(p_crianca_id) and exists (
    select 1 from comunica_pronunciation_private.professional_access a
    where a.crianca_id = p_crianca_id and a.professional_id = (select auth.uid())
      and (not p_observe or a.can_observe)
  );
$$;

create function comunica_pronunciation_private.can_read(p_crianca_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select comunica_links_private.can_view_child_as_guardian(p_crianca_id)
    or comunica_pronunciation_private.professional_can_access(p_crianca_id, false);
$$;

create function public.get_caa_pronunciation_settings(p_crianca_id uuid)
returns table (can_read boolean, can_record boolean, can_manage boolean, retention_days integer)
language sql stable security definer set search_path = '' as $$
  select
    comunica_pronunciation_private.can_read(p_crianca_id),
    comunica_links_private.can_edit_child_as_guardian(p_crianca_id),
    comunica_links_private.owns_child(p_crianca_id),
    case when comunica_pronunciation_private.can_read(p_crianca_id) then coalesce((
      select s.retention_days from comunica_pronunciation_private.settings s
      where s.crianca_id = p_crianca_id
    ), 90) end;
$$;

create function public.list_caa_pronunciation_access(p_crianca_id uuid)
returns table (professional_id uuid, professional_name text, can_listen boolean, can_observe boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Child access denied.';
  end if;
  return query
    select m.professional_id, p.nome, a.professional_id is not null, coalesce(a.can_observe, false)
    from public.caa_members m
    join public.caa_profiles p on p.id = m.professional_id
    left join comunica_pronunciation_private.professional_access a
      on a.crianca_id = m.crianca_id and a.professional_id = m.professional_id
    where m.crianca_id = p_crianca_id and m.approved_at is not null
    order by p.nome, m.professional_id;
end;
$$;

create function public.set_caa_pronunciation_access(
  p_crianca_id uuid, p_professional_id uuid, p_can_listen boolean, p_can_observe boolean
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.criancas c where c.id = p_crianca_id for no key update;
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Child access denied.';
  end if;
  perform 1 from public.caa_members m
  where m.crianca_id = p_crianca_id and m.professional_id = p_professional_id
    and m.approved_at is not null for key share;
  if not found then raise insufficient_privilege using message = 'Professional link is not approved.'; end if;
  if p_can_listen is null or p_can_observe is null or (p_can_observe and not p_can_listen) then
    raise invalid_parameter_value using message = 'Invalid audio permission.';
  end if;
  if p_can_listen then
    insert into comunica_pronunciation_private.professional_access (crianca_id, professional_id, can_observe)
    values (p_crianca_id, p_professional_id, p_can_observe)
    on conflict (crianca_id, professional_id) do update set can_observe = excluded.can_observe;
  else
    delete from comunica_pronunciation_private.professional_access a
    where a.crianca_id = p_crianca_id and a.professional_id = p_professional_id;
  end if;
end;
$$;

create function public.set_caa_pronunciation_retention(p_crianca_id uuid, p_days integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.criancas c where c.id = p_crianca_id for no key update;
  if not comunica_links_private.owns_child(p_crianca_id) then
    raise insufficient_privilege using message = 'Child access denied.';
  end if;
  if p_days is null or p_days not in (30, 90, 180, 365) then
    raise invalid_parameter_value using message = 'Invalid retention.';
  end if;
  insert into comunica_pronunciation_private.settings (crianca_id, retention_days)
  values (p_crianca_id, p_days) on conflict (crianca_id) do update set retention_days = excluded.retention_days;
  -- Shorter limits apply immediately. Older clips keep the term accepted when
  -- they were recorded if the guardian increases retention.
  update comunica_pronunciation_private.recordings r
  set expires_at = r.created_at + pg_catalog.make_interval(days => p_days)
  where r.crianca_id = p_crianca_id
    and r.expires_at > r.created_at + pg_catalog.make_interval(days => p_days);
  delete from comunica_pronunciation_private.recordings r
  where r.crianca_id = p_crianca_id and r.expires_at <= pg_catalog.now();
end;
$$;

create function public.save_caa_pronunciation(
  p_crianca_id uuid, p_id uuid, p_practice text, p_content_type text, p_audio_base64 text, p_authorized boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_audio bytea;
  v_now timestamptz;
  v_days integer;
begin
  perform 1 from public.criancas c where c.id = p_crianca_id for no key update;
  if p_authorized is distinct from true or not comunica_links_private.can_edit_child_as_guardian(p_crianca_id) then
    raise insufficient_privilege using message = 'Recording authorization required.';
  end if;
  if p_id is null or coalesce(pg_catalog.char_length(pg_catalog.btrim(p_practice)), 0) not between 1 and 160
    or p_content_type is null or p_content_type not in ('audio/webm', 'audio/mp4', 'audio/ogg')
    or coalesce(pg_catalog.char_length(p_audio_base64), 0) not between 16 and 2796204 then
    raise invalid_parameter_value using message = 'Invalid recording.';
  end if;
  v_audio := pg_catalog.decode(p_audio_base64, 'base64');
  if pg_catalog.octet_length(v_audio) not between 12 and 2097152
    or (p_content_type = 'audio/webm' and substring(v_audio from 1 for 4) <> pg_catalog.decode('1a45dfa3', 'hex'))
    or (p_content_type = 'audio/mp4' and substring(v_audio from 5 for 4) <> pg_catalog.decode('66747970', 'hex'))
    or (p_content_type = 'audio/ogg' and substring(v_audio from 1 for 4) <> pg_catalog.decode('4f676753', 'hex')) then
    raise invalid_parameter_value using message = 'Invalid audio content.';
  end if;
  v_now := pg_catalog.clock_timestamp();
  select s.retention_days into v_days from comunica_pronunciation_private.settings s where s.crianca_id = p_crianca_id;
  insert into comunica_pronunciation_private.recordings
    (id, crianca_id, captured_by, practice, mime_type, audio, created_at, expires_at)
  values
    (p_id, p_crianca_id, auth.uid(), pg_catalog.btrim(p_practice), p_content_type, v_audio, v_now,
     v_now + pg_catalog.make_interval(days => coalesce(v_days, 90)))
  on conflict (id) do nothing;
  if not found and not exists (
    select 1 from comunica_pronunciation_private.recordings r
    where r.id = p_id and r.crianca_id = p_crianca_id and r.captured_by = auth.uid()
  ) then
    raise insufficient_privilege using message = 'Recording access denied.';
  end if;
  return p_id;
end;
$$;

create function public.list_caa_pronunciation(
  p_crianca_id uuid, p_before_time timestamptz, p_before_id uuid
)
returns table (id uuid, practice text, created_at timestamptz, expires_at timestamptz,
  can_delete boolean, can_observe boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not comunica_pronunciation_private.can_read(p_crianca_id) then
    raise insufficient_privilege using message = 'Recording access denied.';
  end if;
  return query
    select r.id, r.practice, r.created_at, r.expires_at,
      comunica_links_private.owns_child(p_crianca_id) or coalesce(r.captured_by = (select auth.uid())
        and comunica_links_private.can_edit_child_as_guardian(p_crianca_id), false),
      comunica_pronunciation_private.professional_can_access(p_crianca_id, true)
    from comunica_pronunciation_private.recordings r
    where r.crianca_id = p_crianca_id and r.expires_at > pg_catalog.now()
      and (p_before_time is null or (r.created_at, r.id) < (p_before_time, p_before_id))
    order by r.created_at desc, r.id desc limit 51;
end;
$$;

create function comunica_pronunciation_private.readable_recording(p_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_child uuid;
begin
  select r.crianca_id into v_child
  from comunica_pronunciation_private.recordings r
  where r.id = p_id and r.expires_at > pg_catalog.now();
  if v_child is null or not comunica_pronunciation_private.can_read(v_child) then
    raise insufficient_privilege using message = 'Recording access denied.';
  end if;
  return v_child;
end;
$$;

create function public.get_caa_pronunciation_audio(p_id uuid)
returns table (mime_type text, audio_base64 text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform comunica_pronunciation_private.readable_recording(p_id);
  return query select r.mime_type, pg_catalog.encode(r.audio, 'base64')
  from comunica_pronunciation_private.recordings r where r.id = p_id;
end;
$$;

create function public.list_caa_pronunciation_notes(p_id uuid)
returns table (id uuid, author_name text, observation text, updated_at timestamptz, own boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform comunica_pronunciation_private.readable_recording(p_id);
  return query
    select n.id, coalesce(p.nome, 'Profissional'), n.observation, n.updated_at,
      coalesce(n.author_id = (select auth.uid()), false)
    from comunica_pronunciation_private.notes n
    left join public.caa_profiles p on p.id = n.author_id
    where n.recording_id = p_id order by n.updated_at desc, n.id;
end;
$$;

create function public.save_caa_pronunciation_note(p_id uuid, p_observation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_child uuid;
begin
  v_child := comunica_pronunciation_private.readable_recording(p_id);
  if not comunica_pronunciation_private.professional_can_access(v_child, true) then
    raise insufficient_privilege using message = 'Professional observation permission required.';
  end if;
  if coalesce(pg_catalog.char_length(pg_catalog.btrim(p_observation)), 0) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'Invalid observation.';
  end if;
  insert into comunica_pronunciation_private.notes (recording_id, author_id, observation)
  values (p_id, auth.uid(), pg_catalog.btrim(p_observation))
  on conflict (recording_id, author_id) do update
  set observation = excluded.observation, updated_at = pg_catalog.clock_timestamp();
end;
$$;

create function public.delete_caa_pronunciation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_child uuid; v_recorder uuid;
begin
  select r.crianca_id, r.captured_by into v_child, v_recorder
  from comunica_pronunciation_private.recordings r where r.id = p_id;
  if not found or not (comunica_links_private.owns_child(v_child)
    or (v_recorder is not distinct from auth.uid() and comunica_links_private.can_edit_child_as_guardian(v_child))) then
    raise insufficient_privilege using message = 'Recording access denied.';
  end if;
  delete from comunica_pronunciation_private.recordings r where r.id = p_id;
end;
$$;

create function comunica_pronunciation_private.purge_expired()
returns void language sql security definer set search_path = '' as $$
  delete from comunica_pronunciation_private.recordings r where r.expires_at <= pg_catalog.now();
$$;

revoke all on all functions in schema comunica_pronunciation_private from public, anon, authenticated;
revoke all on function
  public.get_caa_pronunciation_settings(uuid), public.list_caa_pronunciation_access(uuid),
  public.set_caa_pronunciation_access(uuid, uuid, boolean, boolean),
  public.set_caa_pronunciation_retention(uuid, integer),
  public.save_caa_pronunciation(uuid, uuid, text, text, text, boolean),
  public.list_caa_pronunciation(uuid, timestamptz, uuid), public.get_caa_pronunciation_audio(uuid),
  public.list_caa_pronunciation_notes(uuid), public.save_caa_pronunciation_note(uuid, text),
  public.delete_caa_pronunciation(uuid)
from public, anon, authenticated;
grant execute on function
  public.get_caa_pronunciation_settings(uuid), public.list_caa_pronunciation_access(uuid),
  public.set_caa_pronunciation_access(uuid, uuid, boolean, boolean),
  public.set_caa_pronunciation_retention(uuid, integer),
  public.save_caa_pronunciation(uuid, uuid, text, text, text, boolean),
  public.list_caa_pronunciation(uuid, timestamptz, uuid), public.get_caa_pronunciation_audio(uuid),
  public.list_caa_pronunciation_notes(uuid), public.save_caa_pronunciation_note(uuid, text),
  public.delete_caa_pronunciation(uuid)
to authenticated;

-- Managed Supabase supplies pg_cron. PGlite fixtures do not ship that
-- extension and exercise purge_expired directly.
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('comunica-expired-pronunciation', '17 * * * *',
      'select comunica_pronunciation_private.purge_expired()');
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- Distinguish new selections from sentences whose playback has started.
begin;

alter table public.comunicacoes
  add column event_type text not null default 'legacy_symbol',
  add column symbol_source text,
  add column arasaac_id integer,
  alter column pictograma_id drop not null,
  alter column categoria drop not null,
  drop constraint comunicacoes_rotulo_check,
  drop constraint comunicacoes_categoria_check;

-- Old rows can represent a tap or a replayed sentence constituent. Keep their
-- original labels and time without relabeling either kind as a confirmed tap.
alter table public.comunicacoes
  add constraint comunicacoes_event_shape check (
    case event_type
      when 'legacy_symbol' then
        pictograma_id is not null and categoria is not null
        and char_length(btrim(rotulo)) between 1 and 120
        and char_length(btrim(categoria)) between 1 and 50
        and symbol_source is null and arasaac_id is null
      when 'symbol_selection' then
        pictograma_id is not null and categoria is not null
        and char_length(btrim(rotulo)) between 1 and 120
        and char_length(btrim(categoria)) between 1 and 80
        and symbol_source is not null and symbol_source in ('catalog', 'custom')
        and (arasaac_id is null or arasaac_id > 0)
      when 'message_playback' then
        pictograma_id is null and categoria is null
        and char_length(btrim(rotulo)) between 1 and 16000
        and symbol_source is null and arasaac_id is null
      else false
    end
  );

-- Private images are resolved by the existing per-patient authorization and
-- current custom symbol ID. History stores neither a private path nor a copy.
-- The public ARASAAC ID is optional, including for a custom symbol with a photo.
grant insert (event_type, symbol_source, arasaac_id)
  on public.comunicacoes to authenticated;

alter policy comunicacoes_insert_own on public.comunicacoes with check (
  usuario_id = (select auth.uid())
  and comunica_react_private.has_role('responsavel')
  and not exists (
    select 1 from public.caa_board_settings b
    where b.crianca_id = comunicacoes.crianca_id
      and b.settings->'historyRecording' = 'false'::jsonb
  )
  and (
    symbol_source is distinct from 'custom'
    or exists (
      select 1 from public.caa_custom_symbols s
      where s.crianca_id = comunicacoes.crianca_id
        and s.id::text = comunicacoes.pictograma_id
    )
  )
);

-- Board edits by a linked professional and clients unaware of this preference
-- preserve the guardian's choice. Keep the existing lock and version checks.
create or replace function public.save_caa_board_settings(
  p_crianca_id uuid, p_settings jsonb, p_expected_version integer
)
returns setof public.caa_board_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_guardian uuid;
  v_version integer;
  v_history_recording jsonb;
begin
  v_guardian := comunica_board_private.lock_board(p_crianca_id);
  select b.version, b.settings->'historyRecording' into v_version, v_history_recording
    from public.caa_board_settings b where b.crianca_id = p_crianca_id;
  if coalesce(v_version, 0) is distinct from p_expected_version then
    raise sqlstate '40001' using message = 'Board settings changed. Reload before retrying.';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise invalid_parameter_value using message = 'Board settings must be an object.';
  end if;

  if v_guardian is distinct from auth.uid() or not (p_settings ? 'historyRecording') then
    p_settings := p_settings - 'historyRecording';
    if v_history_recording is not null then
      p_settings := jsonb_set(p_settings, '{historyRecording}', v_history_recording);
    end if;
  elsif jsonb_typeof(p_settings->'historyRecording') is distinct from 'boolean' then
    raise invalid_parameter_value using message = 'History recording preference must be a boolean.';
  end if;

  return query
    insert into public.caa_board_settings as b (crianca_id, settings)
    values (p_crianca_id, p_settings)
    on conflict (crianca_id) do update
      set settings = excluded.settings, version = b.version + 1, updated_at = clock_timestamp()
    returning b.*;
end;
$$;

-- CREATE OR REPLACE preserves the original column order and view grants.
create or replace view public.caa_events with (security_invoker = true) as
select id, usuario_id, crianca_id, pictograma_id, rotulo, categoria, created_at,
  event_type, symbol_source, arasaac_id
from public.comunicacoes;

create index comunicacoes_crianca_data_idx
  on public.comunicacoes (crianca_id, created_at desc, id desc);

notify pgrst, 'reload schema';

commit;

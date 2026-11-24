-- Date boundaries and text matching are evaluated before fetching one page.
begin;

create function public.query_caa_history(
  p_crianca_id uuid, p_from date, p_to date, p_event_type text, p_search text,
  p_before_time timestamptz, p_before_id uuid
)
returns setof public.comunicacoes
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_today date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  if (p_from is null) <> (p_to is null)
    or (p_from is not null and (p_from < date '2020-01-01' or p_to > v_today or p_from > p_to))
    or (p_before_time is null) <> (p_before_id is null)
    or (p_event_type is not null and p_event_type not in ('symbol_selection', 'message_playback'))
    or pg_catalog.char_length(p_search) > 160 then
    raise invalid_parameter_value using message = 'Invalid history filter.';
  end if;

  v_start := p_from::timestamp at time zone 'America/Sao_Paulo';
  v_end := (p_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  return query
    select c.* from public.comunicacoes c
    where c.crianca_id = p_crianca_id
      and (v_start is null or (c.created_at >= v_start and c.created_at < v_end))
      and (p_before_time is null or (c.created_at, c.id) < (p_before_time, p_before_id))
      and (p_event_type is null or c.event_type = p_event_type)
      and (coalesce(p_search, '') = '' or pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(pg_catalog.normalize(pg_catalog.concat_ws(' ',
            c.rotulo, c.categoria, case c.event_type
              when 'symbol_selection' then 'Seleção de símbolo'
              when 'message_playback' then 'Mensagem reproduzida'
              else 'Registro anterior'
            end,
            case when c.symbol_source = 'custom' then 'Personalizado' end
          ), 'NFD'), U&'[\0300-\036f]', '', 'g'),
          '[[:space:]]+', ' ', 'g'
        )), p_search
      ) > 0)
    order by c.created_at desc, c.id desc
    limit 101;
end;
$$;

revoke all on function public.query_caa_history(uuid, date, date, text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.query_caa_history(uuid, date, date, text, text, timestamptz, uuid)
  to authenticated;
notify pgrst, 'reload schema';
commit;

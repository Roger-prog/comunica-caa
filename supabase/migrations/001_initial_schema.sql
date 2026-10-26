-- Comunica - CAA / React: execute esta migracao uma unica vez no SQL Editor.
-- Supabase fornece auth.users, auth.uid(), anon e authenticated.
-- A migracao nao altera tabelas caa_* nem importa criancas do sistema legado.
begin;

create schema if not exists comunica_react_private;
revoke all on schema comunica_react_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.criancas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, usuario_id)
);

-- O historico registra uso da prancha; nao representa avaliacao clinica.
create table public.comunicacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  crianca_id uuid not null,
  pictograma_id text not null
    check (char_length(btrim(pictograma_id)) between 1 and 80),
  rotulo text not null check (char_length(btrim(rotulo)) between 1 and 120),
  categoria text not null check (char_length(btrim(categoria)) between 1 and 50),
  created_at timestamptz not null default now(),
  foreign key (crianca_id, usuario_id)
    references public.criancas(id, usuario_id) on delete cascade
);

create index criancas_usuario_nome_idx on public.criancas (usuario_id, nome);
create index comunicacoes_usuario_crianca_data_idx
  on public.comunicacoes (usuario_id, crianca_id, created_at desc, id);

alter table public.profiles enable row level security;
alter table public.criancas enable row level security;
alter table public.comunicacoes enable row level security;

-- Nao dependemos dos grants padrao do projeto Supabase.
revoke all on table public.profiles, public.criancas, public.comunicacoes
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant insert (id, nome) on public.profiles to authenticated;
grant update (nome) on public.profiles to authenticated;
grant select, delete on public.criancas to authenticated;
grant insert (id, usuario_id, nome) on public.criancas to authenticated;
grant update (nome) on public.criancas to authenticated;
grant select, delete on public.comunicacoes to authenticated;
grant insert (id, usuario_id, crianca_id, pictograma_id, rotulo, categoria)
  on public.comunicacoes to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- Exclusao de conta ocorre pelo Supabase Auth em ambiente administrativo.
-- Nao ha grant/policy DELETE de profiles para clientes autenticados.

create policy criancas_select_own on public.criancas
  for select to authenticated using (usuario_id = (select auth.uid()));
create policy criancas_insert_own on public.criancas
  for insert to authenticated with check (usuario_id = (select auth.uid()));
create policy criancas_update_own on public.criancas
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));
create policy criancas_delete_own on public.criancas
  for delete to authenticated using (usuario_id = (select auth.uid()));

create policy comunicacoes_select_own on public.comunicacoes
  for select to authenticated using (usuario_id = (select auth.uid()));
create policy comunicacoes_insert_own on public.comunicacoes
  for insert to authenticated with check (usuario_id = (select auth.uid()));
create policy comunicacoes_delete_own on public.comunicacoes
  for delete to authenticated using (usuario_id = (select auth.uid()));
-- Sem UPDATE: alterar usuario_id, crianca_id ou um evento existente e negado.
-- A FK composta impede vincular uma comunicacao a crianca de outro usuario.

create function comunica_react_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function comunica_react_private.touch_updated_at()
  from public, anon, authenticated;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function comunica_react_private.touch_updated_at();
create trigger criancas_touch_updated_at
before update on public.criancas
for each row execute function comunica_react_private.touch_updated_at();

-- Apenas esta funcao recebe privilegios elevados para criar o perfil inicial.
-- Metadados de cadastro sao usados somente como texto, nunca como permissao.
create function comunica_react_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome)
  values (
    new.id,
    pg_catalog.left(
      coalesce(
        nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'nome'), ''),
        nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'name'), ''),
        'Usuario'
      ),
      80
    )
  );
  return new;
end;
$$;
revoke all on function comunica_react_private.handle_new_user()
  from public, anon, authenticated;

create trigger comunica_react_user_created
after insert on auth.users
for each row execute function comunica_react_private.handle_new_user();

-- Auth ja existente recebe perfil; dados de criancas/historico nao sao migrados.
insert into public.profiles (id, nome)
select
  id,
  pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(raw_user_meta_data ->> 'nome'), ''),
      nullif(pg_catalog.btrim(raw_user_meta_data ->> 'name'), ''),
      'Usuario'
    ),
    80
  )
from auth.users
on conflict (id) do nothing;

commit;

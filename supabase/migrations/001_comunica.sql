-- Comunica: execute once in the SQL Editor of a NEW Supabase project.
-- Auth is managed by Supabase. No password or service key belongs in this file.
begin;
create schema if not exists comunica_private;
revoke all on schema comunica_private from public, anon, authenticated;

create table public.caa_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 80),
 role text not null check (role in ('responsavel','fonoaudiologo')),
 consent_at timestamptz not null default now()
);
create table public.caa_children (
 id bigint generated always as identity primary key,
 name text not null check (length(btrim(name)) between 1 and 80),
 owner_id uuid not null references public.caa_profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.caa_members (
 child_id bigint not null references public.caa_children(id) on delete cascade,
 user_id uuid not null references public.caa_profiles(id) on delete cascade,
 primary key (child_id,user_id)
);
create table public.caa_words (
 id bigint generated always as identity primary key,
 child_id bigint not null references public.caa_children(id) on delete cascade,
 label text not null check (length(btrim(label)) between 1 and 60),
 symbol text not null check (length(btrim(symbol)) between 1 and 12),
 category text not null check (length(btrim(category)) between 1 and 40),
 active integer not null default 1 check (active in (0,1)),
 unique(child_id,label), unique(id,child_id)
);
create table public.caa_events (
 id bigint generated always as identity primary key,
 child_id bigint not null references public.caa_children(id) on delete cascade,
 word_id bigint not null,
 user_id uuid references public.caa_profiles(id) on delete set null,
 author_name text not null,
 kind text not null check (kind in ('use','evolution')),
 stage integer not null check (stage between 0 and 3),
 note text not null default '' check (length(note)<=1000),
 word_label text not null,
 created_at timestamptz not null default now(),
 request_id text not null check(length(request_id) between 16 and 100),
 unique(user_id,request_id),
 foreign key(word_id,child_id) references public.caa_words(id,child_id) on delete cascade,
 check(kind <> 'use' or stage=0)
);
create index caa_children_owner on public.caa_children(owner_id);
create index caa_members_user on public.caa_members(user_id);
create index caa_events_child_date on public.caa_events(child_id,created_at);
create index caa_events_word on public.caa_events(word_id,id desc);

-- Deny direct table access. The sole public RPC below enforces per-child access.
alter table public.caa_profiles enable row level security;
alter table public.caa_children enable row level security;
alter table public.caa_members enable row level security;
alter table public.caa_words enable row level security;
alter table public.caa_events enable row level security;
revoke all on public.caa_profiles, public.caa_children, public.caa_members,
 public.caa_words, public.caa_events from public, anon, authenticated;
revoke all on sequence public.caa_children_id_seq, public.caa_words_id_seq,
 public.caa_events_id_seq from public, anon, authenticated;

create function comunica_private.new_user() returns trigger language plpgsql
 security definer set search_path='' as $$
begin
 if coalesce(new.raw_user_meta_data->>'consent','false') <> 'true' then
   raise exception 'Confirme o aviso de armazenamento de dados.';
 end if;
 insert into public.caa_profiles(id,name,role)
 values(new.id,btrim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'role');
 return new;
end; $$;
revoke all on function comunica_private.new_user() from public,anon,authenticated;
create trigger comunica_new_user after insert on auth.users
 for each row execute function comunica_private.new_user();

create function comunica_private.report(p_child bigint,p_days integer)
 returns jsonb language sql set search_path='' as $$
 with cutoff as (
   select (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')
      - make_interval(days=>p_days-1) as since
 ), vocabulary as (
   select w.*,
    (select count(*) from public.caa_events e,cutoff c where e.word_id=w.id and e.kind='use' and e.created_at>=c.since) as uses,
    (select e.stage from public.caa_events e where e.word_id=w.id and e.kind='evolution' order by e.id desc limit 1) as stage
   from public.caa_words w where w.child_id=p_child
 ), daily as (
   select to_char(e.created_at at time zone 'UTC','YYYY-MM-DD') as day,count(*) as count
   from public.caa_events e,cutoff c where e.child_id=p_child and e.kind='use' and e.created_at>=c.since group by 1
 ) select jsonb_build_object(
   'days',p_days,'child_name',(select name from public.caa_children where id=p_child),
   'total_uses',coalesce((select sum(uses) from vocabulary),0),
   'mastered',(select count(*) from vocabulary where stage=3),
   'words',coalesce((select jsonb_agg(to_jsonb(v) order by uses desc,label) from vocabulary v),'[]'::jsonb),
   'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'::jsonb)
 ); $$;
revoke all on function comunica_private.report(bigint,integer) from public,anon,authenticated;

create function public.comunica_api(p_action text,p_child bigint default null,
 p_target text default null,p_data jsonb default '{}'::jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid := auth.uid();
 person public.caa_profiles%rowtype;
 child public.caa_children%rowtype;
 word public.caa_words%rowtype;
 old_event public.caa_events%rowtype;
 result jsonb;
 new_id bigint;
 target_user uuid;
 days integer;
begin
 if uid is null then raise exception using errcode='28000',message='Entre novamente para continuar.'; end if;
 select * into person from public.caa_profiles where id=uid;
 if not found then raise exception using errcode='28000',message='Perfil de usuário não encontrado.'; end if;
 if p_action='me' then
   return to_jsonb(person) || jsonb_build_object('email',(select email from auth.users where id=uid));
 elsif p_action='children' then
   select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]'::jsonb) into result
    from public.caa_children c where c.owner_id=uid or exists(select 1 from public.caa_members m where m.child_id=c.id and m.user_id=uid);
   return result;
 elsif p_action='add_child' then
   if person.role<>'responsavel' then raise exception using errcode='42501',message='O responsável cadastra a criança e autoriza a equipe.'; end if;
   insert into public.caa_children(name,owner_id) values(btrim(p_data->>'name'),uid) returning * into child;
   insert into public.caa_words(child_id,label,symbol,category)
   select child.id,v.* from (values
    ('Água','💧','Necessidades'),('Comer','🍎','Necessidades'),('Banheiro','🚽','Necessidades'),('Dormir','🌙','Necessidades'),
    ('Feliz','😊','Sentimentos'),('Triste','😢','Sentimentos'),('Dor','🤕','Sentimentos'),('Abraço','🤗','Sentimentos'),
    ('Brincar','🧸','Atividades'),('Passear','🌳','Atividades'),('Sim','👍','Escolhas'),('Não','👎','Escolhas'),
    ('Ajuda','🙋','Necessidades'),('Mais','➕','Escolhas'),('Parar','✋','Escolhas'),('Casa','🏠','Lugares')
   ) as v(label,symbol,category);
   return to_jsonb(child);
 end if;
 -- Every remaining action requires membership; no caller-supplied owner/user ID.
 select * into child from public.caa_children where id=p_child;
 if not found or (child.owner_id<>uid and not exists(select 1 from public.caa_members where child_id=p_child and user_id=uid)) then
   raise exception using errcode='42501',message='Você não tem acesso a este perfil.';
 end if;
 if p_action='words' then
   select coalesce(jsonb_agg(to_jsonb(w) order by w.id),'[]'::jsonb) into result from public.caa_words w where child_id=p_child;
   return result;
 elsif p_action in ('add_word','edit_word') then
   if p_action='add_word' then
     insert into public.caa_words(child_id,label,symbol,category,active)
     values(p_child,btrim(p_data->>'label'),btrim(p_data->>'symbol'),btrim(p_data->>'category'),case when coalesce((p_data->>'active')::boolean,true) then 1 else 0 end) returning id into new_id;
   else
     update public.caa_words set label=btrim(p_data->>'label'),symbol=btrim(p_data->>'symbol'),category=btrim(p_data->>'category'),active=case when coalesce((p_data->>'active')::boolean,true) then 1 else 0 end
      where id=p_target::bigint and child_id=p_child returning id into new_id;
     if not found then raise exception 'Palavra não encontrada.'; end if;
   end if;
   return jsonb_build_object('id',new_id);
 elsif p_action='add_event' then
   select * into word from public.caa_words where id=(p_data->>'word_id')::bigint and child_id=p_child;
   if not found then raise exception 'Palavra não encontrada neste perfil.'; end if;
   if p_data->>'kind'='use' and (p_data->>'stage')::integer<>0 then raise exception 'Uso da prancha não confirma vocalização ou domínio.'; end if;
   select * into old_event from public.caa_events where user_id=uid and request_id=p_data->>'request_id';
   if found then
     if old_event.child_id<>p_child or old_event.word_id<>word.id or old_event.kind is distinct from p_data->>'kind' or old_event.stage is distinct from (p_data->>'stage')::integer or old_event.note is distinct from coalesce(p_data->>'note','') then
       raise exception 'Identificador já usado para outro registro.';
     end if;
     return to_jsonb(old_event);
   end if;
   if word.active=0 then raise exception 'Reative a palavra antes de registrar uma interação.'; end if;
   insert into public.caa_events(child_id,word_id,user_id,author_name,kind,stage,note,word_label,request_id)
   values(p_child,word.id,uid,person.name,p_data->>'kind',(p_data->>'stage')::integer,coalesce(p_data->>'note',''),word.label,p_data->>'request_id')
   on conflict(user_id,request_id) do nothing returning * into old_event;
   if not found then
     select * into old_event from public.caa_events where user_id=uid and request_id=p_data->>'request_id';
     if old_event.child_id<>p_child or old_event.word_id<>word.id or old_event.kind is distinct from p_data->>'kind' or old_event.stage is distinct from (p_data->>'stage')::integer or old_event.note is distinct from coalesce(p_data->>'note','') then raise exception 'Identificador já usado para outro registro.'; end if;
   end if;
   return to_jsonb(old_event);
 elsif p_action='report' then
   days := coalesce((p_data->>'days')::integer,7);
   if days<1 or days>365 then raise exception 'Período inválido.'; end if;
   return comunica_private.report(p_child,days);
 elsif p_action='history' then
   select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into result from (
    select ev.*,ev.author_name as author from public.caa_events ev where ev.child_id=p_child and ev.id<coalesce((p_data->>'before')::bigint,9223372036854775807) order by ev.id desc limit 50
   ) e;
   return result;
 elsif p_action in ('members','grant','revoke') then
   if child.owner_id<>uid then raise exception using errcode='42501',message='Somente o responsável pode alterar a equipe.'; end if;
   if p_action='members' then
     select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'email',au.email) order by pr.name),'[]'::jsonb) into result
      from public.caa_members m join public.caa_profiles pr on pr.id=m.user_id join auth.users au on au.id=pr.id where m.child_id=p_child;
     return result;
   elsif p_action='grant' then
     select pr.id into target_user from public.caa_profiles pr join auth.users au on au.id=pr.id where lower(au.email)=lower(btrim(p_data->>'email')) and pr.role='fonoaudiologo';
     if not found then raise exception 'Peça ao profissional para criar uma conta de fonoaudiólogo primeiro.'; end if;
     insert into public.caa_members values(p_child,target_user) on conflict do nothing;
     return jsonb_build_object('user_id',target_user);
   else
     delete from public.caa_members where child_id=p_child and user_id=p_target::uuid;
     return '{}'::jsonb;
   end if;
 end if;
 raise exception 'Operação desconhecida.';
exception
 when unique_violation then raise exception 'Essa palavra já está no vocabulário.';
 when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'Confira os dados informados e tente novamente.';
end; $$;
revoke all on function public.comunica_api(text,bigint,text,jsonb) from public,anon;
grant execute on function public.comunica_api(text,bigint,text,jsonb) to authenticated;
comment on function public.comunica_api(text,bigint,text,jsonb) is 'Entry point with auth.uid(), per-child authorization, validated inputs and fixed search_path. No direct table access.';
commit;

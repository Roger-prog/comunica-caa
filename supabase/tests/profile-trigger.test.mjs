import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const GOOGLE_USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const PROFESSIONAL = '33333333-3333-4333-8333-333333333333';
const NEW_GUARDIAN = '44444444-4444-4444-8444-444444444444';
const NEW_PROFESSIONAL = '55555555-5555-4555-8555-555555555555';
const INVALID_USER = '66666666-6666-4666-8666-666666666666';
const CHILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const migrations = await Promise.all([
  '001_initial_schema.sql', '002_professional_links.sql', '003_account_roles.sql',
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));
const repair = () => readFile(new URL('../migrations/004_profile_trigger_repair.sql', import.meta.url), 'utf8');

async function createProfileTriggerFixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{"provider":"email"}'::jsonb,
      email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const migration of migrations) await db.exec(migration);
  return db;
}

async function addDuplicateProfileWriter(db) {
  // A synthetic legacy writer deliberately coexists with the canonical trigger.
  // Its name is a test fixture, not an assumption about any remote project.
  await db.exec(`
    create function public.legacy_profile_writer_fixture()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      insert into public.caa_profiles(id, nome)
      values(new.id, 'Perfil legado de exemplo');
      return new;
    end;
    $$;
    create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.legacy_profile_writer_fixture();
  `);
}

async function addObservedLegacyWriter(db) {
  // This reproduces the conflicting writer identified in the database
  // inventory, including its IF NOT EXISTS check and metadata-only values.
  await db.exec(`
    create schema comunica_private;
    revoke all on schema comunica_private from public, anon, authenticated;
    create function comunica_private.new_user()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      -- Verifica se o perfil já existe antes de tentar inserir
      if not exists (select 1 from public.caa_profiles where id = new.id) then
        insert into public.caa_profiles(id, nome, role)
        values(new.id, btrim(new.raw_user_meta_data->>'name'), new.raw_user_meta_data->>'role');
      end if;
      return new;
    end;
    $$;
    revoke all on function comunica_private.new_user() from public, anon, authenticated;
    create trigger comunica_new_user
    after insert on auth.users
    for each row execute function comunica_private.new_user();
  `);
}

async function addIndependentAuditTrigger(db) {
  await db.exec(`
    create schema profile_fixture_audit;
    create table profile_fixture_audit.created_accounts(id uuid primary key);
    create function profile_fixture_audit.record_creation()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      insert into profile_fixture_audit.created_accounts(id) values(new.id);
      return new;
    end;
    $$;
    create trigger zz_account_audit_fixture
    after insert on auth.users
    for each row execute function profile_fixture_audit.record_creation();
  `);
}

async function seedExistingData(db) {
  await signup(db, OWNER, { provider: 'email', role: 'responsavel', consent: true, nome: 'Responsavel existente' });
  await signup(db, PROFESSIONAL, { provider: 'email', role: 'fonoaudiologo', consent: true, nome: 'Profissional existente' });
  await db.query('insert into public.criancas(id, usuario_id, nome) values($1, $2, $3)', [CHILD, OWNER, 'Paciente de exemplo']);
  await db.query(`insert into public.comunicacoes(usuario_id, crianca_id, pictograma_id, rotulo, categoria)
    values($1, $2, 'agua', 'Água', 'Necessidades')`, [OWNER, CHILD]);
  await db.query('insert into public.caa_members(crianca_id, professional_id) values($1, $2)', [CHILD, PROFESSIONAL]);
}

async function protectedState(db) {
  const records = {};
  for (const table of ['auth.users', 'public.caa_profiles', 'public.criancas', 'public.comunicacoes', 'public.caa_members']) {
    records[table] = (await db.query(`select * from ${table} order by id`)).rows;
  }
  return {
    records,
    policies: (await db.query(`select tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies where schemaname='public' order by tablename, policyname`)).rows,
    grants: (await db.query(`select grantee, table_name, column_name, privilege_type
      from information_schema.column_privileges where table_schema='public'
      order by grantee, table_name, column_name, privilege_type`)).rows,
    columns: (await db.query(`select a.attname, a.atttypid::text, a.attnotnull
      from pg_attribute a where a.attrelid='public.caa_profiles'::regclass
      and a.attnum>0 and not a.attisdropped order by a.attnum`)).rows,
    constraints: (await db.query(`select conname, contype, convalidated, pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid='public.caa_profiles'::regclass order by conname`)).rows,
    functionAccess: (await db.query(`select n.nspname, p.proname, p.proowner::regrole::text as owner, p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.oid in (to_regprocedure('comunica_react_private.handle_new_user()'),
        to_regprocedure('comunica_private.new_user()')) order by n.nspname, p.proname`)).rows,
    privateSchemas: (await db.query(`select nspname, nspowner::regrole::text as owner, nspacl::text as acl
      from pg_namespace where nspname in ('comunica_private','comunica_react_private','comunica_links_private')
      order by nspname`)).rows,
    rls: (await db.query(`select relname, relrowsecurity from pg_class
      where oid in ('public.caa_profiles'::regclass, 'public.criancas'::regclass,
      'public.comunicacoes'::regclass, 'public.caa_members'::regclass) order by relname`)).rows,
  };
}

async function triggerState(db) {
  return (await db.query(`
    select t.tgname, t.tgtype, t.tgenabled, n.nspname as function_schema,
      p.proname as function_name, pg_get_triggerdef(t.oid) as definition
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace
    where t.tgrelid='auth.users'::regclass and not t.tgisinternal
    order by t.tgname
  `)).rows;
}

async function writerState(db) {
  return (await db.query(`
    select p.oid::text, p.proowner::regrole::text as owner, p.proacl::text as acl,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    where p.oid in ('comunica_private.new_user()'::regprocedure,
      'comunica_react_private.handle_new_user()'::regprocedure)
    order by p.oid
  `)).rows;
}

async function asUser(db, id, callback) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  await db.exec(id ? 'set role authenticated' : 'set role anon');
  try { return await callback(); } finally { await db.exec('reset role'); }
}

async function rejected(promise, expected = '42501') {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, expected, error.message);
    return true;
  });
}

async function signup(db, id, {
  provider = 'google', role = 'fonoaudiologo', consent = false,
  nome = 'Pessoa de exemplo', confirmed = true,
} = {}) {
  return db.query(`
    insert into auth.users(id, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
    values($1, $2, $3, $4)
  `, [id, { nome, name: nome, role, consent }, { provider }, confirmed ? new Date() : null]);
}

test('PostgreSQL: dois gatilhos de perfil reproduzem 23505 e revertem o cadastro Google', async (t) => {
  const db = await createProfileTriggerFixture(t);
  await addDuplicateProfileWriter(db);

  const profileConstraint = (await db.query(`
    select conname from pg_constraint
    where conrelid = 'public.caa_profiles'::regclass and contype = 'p'
  `)).rows[0];
  assert.equal(profileConstraint.conname, 'profiles_pkey');

  await assert.rejects(signup(db, GOOGLE_USER), (error) => {
    assert.equal(error.code, '23505');
    assert.equal(error.constraint, 'profiles_pkey');
    return true;
  });

  // Both writes share the Auth insertion transaction: no partially created
  // account or profile may remain after the duplicate writer aborts it.
  assert.deepEqual((await db.query(`
    select
      (select count(*)::int from auth.users) as accounts,
      (select count(*)::int from public.caa_profiles) as profiles
  `)).rows, [{ accounts: 0, profiles: 0 }]);
});

test('PostgreSQL: o gatilho legado observado cria primeiro e reproduz o conflito de perfil', async (t) => {
  const db = await createProfileTriggerFixture(t);
  await addObservedLegacyWriter(db);
  assert.deepEqual((await triggerState(db)).map((row) => row.tgname), [
    'comunica_new_user', 'comunica_react_user_created',
  ]);
  await assert.rejects(signup(db, GOOGLE_USER), (error) => {
    assert.equal(error.code, '23505');
    assert.equal(error.constraint, 'profiles_pkey');
    return true;
  });
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from public.caa_profiles')).rows[0].n, 0);
});

test('PostgreSQL: reparo preserva dados e auditoria, neutraliza somente o writer legado e restaura cadastros', async (t) => {
  const db = await createProfileTriggerFixture(t);
  await seedExistingData(db);
  await addObservedLegacyWriter(db);
  await addIndependentAuditTrigger(db);
  const before = await protectedState(db);
  const repairSql = await repair();

  await db.exec(repairSql);
  assert.deepEqual(await protectedState(db), before);
  const triggers = await triggerState(db);
  assert.deepEqual(triggers.map((row) => [row.tgname, row.tgenabled]), [
    ['comunica_new_user', 'O'], ['comunica_react_user_created', 'O'], ['zz_account_audit_fixture', 'O'],
  ]);
  assert.notEqual((await db.query("select to_regprocedure('comunica_private.new_user()') as fn")).rows[0].fn, null);
  const legacyDefinition = triggers.find((row) => row.tgname === 'comunica_new_user').definition;
  const legacyBody = (await db.query("select prosrc from pg_proc where oid='comunica_private.new_user()'::regprocedure")).rows[0].prosrc;
  assert.equal(legacyBody.toLowerCase().replace(/\s+/g, ''), 'beginreturnnew;end;');

  // Reapplying the repair must not rewrite existing names, roles or timestamps.
  await db.exec(repairSql);
  assert.deepEqual(await protectedState(db), before);
  assert.equal((await triggerState(db)).find((row) => row.tgname === 'comunica_new_user').definition, legacyDefinition);

  await signup(db, GOOGLE_USER, { role: 'admin', consent: false });
  await signup(db, NEW_GUARDIAN, { provider: 'email', role: 'responsavel', consent: true });
  await signup(db, NEW_PROFESSIONAL, { provider: 'email', role: 'fonoaudiologo', consent: true });
  assert.deepEqual((await db.query('select id, role from public.caa_profiles where id=any($1::uuid[]) order by id',
    [[GOOGLE_USER, NEW_GUARDIAN, NEW_PROFESSIONAL]])).rows, [
    { id: GOOGLE_USER, role: null }, { id: NEW_GUARDIAN, role: 'responsavel' },
    { id: NEW_PROFESSIONAL, role: 'fonoaudiologo' },
  ]);
  assert.equal((await db.query('select count(*)::int as n from profile_fixture_audit.created_accounts')).rows[0].n, 3);

  await asUser(db, GOOGLE_USER, () => db.query(
    "select * from public.complete_caa_profile('fonoaudiologo','Nome confirmado no onboarding',true,$1)", [GOOGLE_USER],
  ));
  const afterOnboarding = await protectedState(db);
  await db.exec(repairSql);
  assert.deepEqual(await protectedState(db), afterOnboarding);
  assert.deepEqual((await db.query('select nome, role from public.caa_profiles where id=$1', [GOOGLE_USER])).rows,
    [{ nome: 'Nome confirmado no onboarding', role: 'fonoaudiologo' }]);

  for (const role of [null, 'admin', '']) {
    await rejected(signup(db, INVALID_USER, { provider: 'email', role, consent: true }), '22023');
  }
  for (const consent of [false, null, 'true']) {
    await rejected(signup(db, INVALID_USER, { provider: 'email', role: 'responsavel', consent }), '22023');
  }
  assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1', [INVALID_USER])).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from profile_fixture_audit.created_accounts where id=$1', [INVALID_USER])).rows[0].n, 0);
  assert.deepEqual((await asUser(db, GOOGLE_USER, () => db.query('select id from public.criancas'))).rows, []);
  await rejected(asUser(db, GOOGLE_USER, () => db.query("update public.caa_profiles set role='responsavel' where id=$1", [GOOGLE_USER])));
  await rejected(asUser(db, GOOGLE_USER, () => db.query("insert into public.criancas(nome) values('Negado')")));
  assert.equal((await db.query("select has_function_privilege('anon', 'comunica_react_private.handle_new_user()', 'execute') as allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('authenticated', 'comunica_react_private.handle_new_user()', 'execute') as allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('anon', 'comunica_private.new_user()', 'execute') as allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('authenticated', 'comunica_private.new_user()', 'execute') as allowed")).rows[0].allowed, false);
});

test('PostgreSQL: reparo sem writer legado continua valido e o writer canonico tolera invocacao repetida', async (t) => {
  const db = await createProfileTriggerFixture(t);
  await db.exec(await repair());
  await db.exec(await repair());
  await db.exec(`
    create trigger zz_repeat_canonical_fixture after insert on auth.users
    for each row execute function comunica_react_private.handle_new_user();
  `);
  await signup(db, GOOGLE_USER);
  assert.deepEqual((await db.query('select id, role from public.caa_profiles')).rows,
    [{ id: GOOGLE_USER, role: null }]);
});

test('PostgreSQL: reparo funciona sem superusuário ou propriedade da tabela Auth', async (t) => {
  const db = await createProfileTriggerFixture(t);
  await addObservedLegacyWriter(db);
  await db.exec(`
    create role sql_editor_fixture nologin nosuperuser;
    create role managed_auth_owner_fixture nologin nosuperuser;
    alter table auth.users owner to managed_auth_owner_fixture;
    grant usage on schema auth, public to sql_editor_fixture, managed_auth_owner_fixture;
    grant select, insert, update on table auth.users to sql_editor_fixture;
    alter schema comunica_private owner to sql_editor_fixture;
    alter schema comunica_react_private owner to sql_editor_fixture;
    alter function comunica_private.new_user() owner to sql_editor_fixture;
    alter function comunica_react_private.handle_new_user() owner to sql_editor_fixture;
    alter table public.caa_profiles owner to sql_editor_fixture;
    set role sql_editor_fixture;
  `);

  const ownerState = async () => (await db.query(`
    select current_user as executor, r.rolsuper as superuser, c.relowner::regrole::text as table_owner
    from pg_roles r cross join pg_class c
    where r.rolname=current_user and c.oid='auth.users'::regclass
  `)).rows;
  const expectedOwner = [{ executor: 'sql_editor_fixture', superuser: false, table_owner: 'managed_auth_owner_fixture' }];
  assert.deepEqual(await ownerState(), expectedOwner);
  await rejected(db.exec('alter table auth.users disable trigger comunica_new_user'));

  const triggersBefore = await triggerState(db);
  const writerAccess = async () => (await writerState(db)).map(({ oid, owner, acl }) => ({ oid, owner, acl }));
  const accessBefore = await writerAccess();
  await db.exec(await repair());
  assert.deepEqual(await ownerState(), expectedOwner);
  assert.deepEqual(await triggerState(db), triggersBefore);
  assert.deepEqual(await writerAccess(), accessBefore);
  await signup(db, GOOGLE_USER);
  assert.deepEqual((await db.query('select id, role from public.caa_profiles')).rows,
    [{ id: GOOGLE_USER, role: null }]);
});

const invalidConfigurations = [
  ['legacy pointer', `
    drop trigger comunica_new_user on auth.users;
    create function public.wrong_pointer_fixture() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger comunica_new_user after insert on auth.users for each row execute function public.wrong_pointer_fixture();
  `],
  ['legacy event', `
    drop trigger comunica_new_user on auth.users;
    create trigger comunica_new_user after update on auth.users for each row execute function comunica_private.new_user();
  `],
  ['legacy enabled state', 'alter table auth.users enable always trigger comunica_new_user;'],
  ['legacy function shared with another trigger', `
    create trigger zz_shared_legacy_fixture after update on auth.users
    for each row execute function comunica_private.new_user();
    alter table auth.users disable trigger zz_shared_legacy_fixture;
  `, /used by another trigger/],
  ['unexpected legacy function logic', `
    create or replace function comunica_private.new_user()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      insert into public.caa_profiles(id, nome) values(new.id, 'Outra rotina');
      return new;
    end;
    $$;
  `, /contains unrecognized logic/],
  ['canonical pointer', `
    drop trigger comunica_react_user_created on auth.users;
    create trigger comunica_react_user_created after insert on auth.users for each row execute function comunica_private.new_user();
  `],
  ['canonical event', `
    drop trigger comunica_react_user_created on auth.users;
    create trigger comunica_react_user_created before insert on auth.users for each row execute function comunica_react_private.handle_new_user();
  `],
  ['canonical disabled state', 'alter table auth.users disable trigger comunica_react_user_created;'],
  ['canonical table RLS', 'alter table public.caa_profiles disable row level security;'],
  ['canonical role column', 'alter table public.caa_profiles alter column role type varchar(32);'],
  ['weakened role constraint', `
    alter table public.caa_profiles drop constraint caa_profiles_role_check;
    alter table public.caa_profiles add constraint caa_profiles_role_check
      check (role in ('responsavel','fonoaudiologo','admin'));
  `],
  ['unvalidated role constraint', `
    alter table public.caa_profiles drop constraint caa_profiles_role_check;
    alter table public.caa_profiles add constraint caa_profiles_role_check
      check (role in ('responsavel','fonoaudiologo')) not valid;
  `],
];

for (const [label, mutation, expectedError] of invalidConfigurations) {
  test(`PostgreSQL: reparo aborta atomicamente com ${label} incompativel`, async (t) => {
    const db = await createProfileTriggerFixture(t);
    await seedExistingData(db);
    await addObservedLegacyWriter(db);
    await db.exec(mutation);
    const before = await protectedState(db);
    const triggersBefore = await triggerState(db);
    const writersBefore = await writerState(db);
    await assert.rejects(db.exec(await repair()), expectedError);
    await db.exec('rollback');
    assert.deepEqual(await protectedState(db), before);
    assert.deepEqual(await triggerState(db), triggersBefore);
    assert.deepEqual(await writerState(db), writersBefore);
  });
}

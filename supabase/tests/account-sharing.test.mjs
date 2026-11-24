import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const invited = '22222222-2222-4222-8222-222222222222';
const unrelated = '33333333-3333-4333-8333-333333333333';
const professional = '44444444-4444-4444-8444-444444444444';
const oldProfessional = '55555555-5555-4555-8555-555555555555';
const child = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherChild = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const migrations = await Promise.all([
  '001_initial_schema.sql', '002_professional_links.sql', '003_account_roles.sql',
  '004_profile_trigger_repair.sql', '005_invitation_ten_minutes.sql', '006_personalized_boards.sql',
  '008_communication_events.sql', '009_account_preferences.sql',
  '010_account_roles_and_professions.sql', '011_patient_guardians.sql',
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{"provider":"email"}', email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text unique not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      bucket_id text references storage.buckets, name text, metadata jsonb, primary key(bucket_id, name)
    );
    create function storage.allow_any_operation(text[]) returns boolean language sql stable as $$
      select coalesce(current_setting('storage.operation', true) = any($1), false)
    $$;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
    alter table storage.objects enable row level security;
    alter table storage.buckets enable row level security;
    create policy fixture_storage_all on storage.objects for all using (true) with check (true);
    create policy fixture_buckets_all on storage.buckets for all using (true) with check (true);
  `);
  for (const migration of migrations.slice(0, -2)) await db.exec(migration);
  const addUser = (id, email, role, details = {}) => db.query(`
    insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())`,
  [id, email, { role, nome: email, consent: true, ...details }]);
  await addUser(owner, 'owner@example.test', 'responsavel');
  await addUser(oldProfessional, 'legacy@example.test', 'fonoaudiologo');
  await db.query('insert into public.criancas(id,usuario_id,nome) values ($1,$2,$3),($4,$2,$5)',
    [child, owner, 'Paciente A', otherChild, 'Paciente B']);
  await db.query('insert into public.caa_members(crianca_id,professional_id) values ($1,$2)', [child, oldProfessional]);
  for (const migration of migrations.slice(-2)) await db.exec(migration);
  await addUser(invited, 'invited@example.test', 'responsavel');
  await addUser(unrelated, 'other@example.test', 'responsavel');
  await addUser(professional, 'doctor@example.test', 'fonoaudiologo', { professional_category: 'Médico' });
  const as = async (user, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec('set role authenticated');
    try { return (await db.query(query, params)).rows; }
    finally { await db.exec('reset role'); }
  };
  return { as, db };
}

test('validated roles are additive and new professional access requires patient authorization', async (t) => {
  const { as, db } = await setup(t);
  const switchRole = (user, role) => as(user, 'select public.switch_caa_account_role($1, $2)', [user, role]);
  await assert.rejects(switchRole(invited, 'fonoaudiologo'), { code: '42501' });
  await assert.rejects(as(invited, "update public.caa_profiles set role = 'fonoaudiologo'"), { code: '42501' });
  await as(invited, "select public.request_caa_account_role($1, 'fonoaudiologo', 'Psicólogo', 'Registro 123')", [invited]);
  assert.equal((await as(invited, 'select * from public.get_caa_account_options()'))[0].professional_pending, true);
  await assert.rejects(as(invited, 'select public.review_caa_professional_role($1,true)', [invited]), { code: '42501' });
  await assert.rejects(switchRole(invited, 'fonoaudiologo'), { code: '42501' });
  assert.equal((await db.query('select public.review_caa_professional_role($1,true) as approved', [invited])).rows[0].approved, true);
  await switchRole(invited, 'fonoaudiologo');
  const options = (await as(invited, 'select * from public.get_caa_account_options()'))[0];
  assert.deepEqual(options.roles, ['fonoaudiologo', 'responsavel']);
  assert.equal(options.professional_validated, true);
  await as(invited, "update public.caa_profiles set professional_category = 'Fisioterapeuta'");
  assert.equal((await as(invited, 'select * from public.get_caa_account_options()'))[0].professional_validated, false);
  await switchRole(invited, 'responsavel');
  assert.deepEqual(await as(invited, 'select * from public.criancas'), []);
  assert.equal((await as(oldProfessional, 'select id from public.criancas'))[0].id, child);

  const [{ code }] = await as(owner, 'select code from public.create_caa_invitation($1)', [child]);
  const [redemption] = await as(professional, 'select * from public.redeem_caa_invitation($1)', [code]);
  assert.equal(redemption.status, 'pending');
  assert.equal(redemption.crianca_id, null);
  assert.deepEqual(await as(professional, 'select * from public.criancas'), []);
  assert.deepEqual(await as(professional, 'select * from public.caa_members'), []);
  const request = (await as(owner, 'select * from public.list_caa_members($1)', [child]))
    .find((member) => member.professional_id === professional);
  assert.equal(request.professional_category, 'Médico');
  assert.equal(request.professional_validated, false);
  assert.equal(request.approved_at, null);
  await assert.rejects(as(unrelated, 'select public.approve_caa_professional_member($1,$2)', [child, professional]), { code: '42501' });
  await as(owner, 'select public.approve_caa_professional_member($1,$2)', [child, professional]);
  assert.deepEqual(await as(professional, 'select id from public.criancas'), [{ id: child }]);
});

test('guardian invites bind to a verified email, expire, and grant only scoped permissions', async (t) => {
  const { as, db } = await setup(t);
  const makeInvite = () => as(owner, 'select * from public.create_caa_guardian_invitation($1,$2)',
    [child, 'INVITED@example.test']);
  const redeem = async (user, code) => (await as(user,
    'select public.redeem_caa_guardian_invitation($1) as patient', [code]))[0].patient;
  const [{ code: expired }] = await makeInvite();
  await db.query("update comunica_links_private.guardian_invitations set expires_at = now() - interval '1 minute'");
  assert.equal(await redeem(invited, expired), null);
  const [{ code }] = await makeInvite();
  assert.equal(await redeem(unrelated, code), null);
  await assert.rejects(redeem(professional, code), { code: '42501' });
  assert.equal(await redeem(invited, code), child);
  assert.equal(await redeem(invited, code), null);
  assert.deepEqual(await as(invited, 'select id from public.criancas'), [{ id: child }]);
  assert.deepEqual(await as(invited, 'select * from public.get_caa_guardian_access($1)', [child]),
    [{ is_owner: false, can_edit: false, can_manage_links: false }]);
  assert.equal((await as(owner, 'select count(*)::int as n from public.list_caa_guardians($1)', [child]))[0].n, 2);
  assert.deepEqual(await as(owner, 'delete from public.criancas where id = $1 returning id', [child]), []);
  await assert.rejects(as(invited, 'select public.create_caa_guardian_invitation($1,$2)', [child, 'other@example.test']), { code: '42501' });
  await assert.rejects(as(invited, 'select public.reserve_caa_symbol_image($1,true)', [child]), { code: '42501' });
  await as(owner, 'select public.set_caa_guardian_permissions($1,$2,true,false)', [child, invited]);
  await as(invited, 'select public.reserve_caa_symbol_image($1,true)', [child]);
  const writeEvent = (user, patient) => as(user, `insert into public.comunicacoes
    (usuario_id,crianca_id,rotulo,event_type) values ($1,$2,'Água','message_playback') returning rotulo`, [owner, patient]);
  assert.deepEqual(await writeEvent(invited, child), [{ rotulo: 'Água' }]);
  await assert.rejects(writeEvent(invited, otherChild), { code: '42501' });
  await as(owner, 'select public.revoke_caa_guardian($1,$2)', [child, invited]);
  assert.deepEqual(await as(invited, 'select * from public.comunicacoes'), []);
  assert.deepEqual(await as(invited, 'select id from public.criancas'), []);
  const [{ status }] = await db.query('select state as status from comunica_board_private.symbol_images').then(({ rows }) => rows);
  assert.equal(status, 'retired');
  await assert.rejects(as(owner, 'select public.delete_own_caa_account($1)', [owner]), { code: '42501' });
});

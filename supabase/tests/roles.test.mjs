import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const LEGACY_PROFESSIONAL = '22222222-2222-4222-8222-222222222222';
const GUARDIAN = '33333333-3333-4333-8333-333333333333';
const PROFESSIONAL = '44444444-4444-4444-8444-444444444444';
const GOOGLE = '55555555-5555-4555-8555-555555555555';
const UNCONFIRMED_GUARDIAN = '66666666-6666-4666-8666-666666666666';
const UNCONFIRMED_PROFESSIONAL = '77777777-7777-4777-8777-777777777777';
const UNCONFIRMED_GOOGLE = '88888888-8888-4888-8888-888888888888';
const INVALID_USER = '99999999-9999-4999-8999-999999999999';
const CHILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const migrations = await Promise.all([
  '001_initial_schema.sql', '002_professional_links.sql', '003_account_roles.sql',
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));

async function fixture(db) {
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
  await db.exec(migrations[0]);
  await db.exec(migrations[1]);
}

function access(db) {
  const asUser = async (id, callback) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try { return await callback(); } finally { await db.exec('reset role'); }
  };
  const denied = (promise, code = '42501') => assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
  const signup = (id, role, confirmed = true, provider = 'email', metadata = {}) => db.query(`
    insert into auth.users(id,raw_user_meta_data,raw_app_meta_data,email_confirmed_at)
    values($1,$2,$3,$4)
  `, [id, { nome: 'Nome de exemplo', role, consent: true, ...metadata },
    { provider }, confirmed ? new Date() : null]);
  return { asUser, denied, signup };
}

test('PostgreSQL: perfis canonicos, confirmacao e isolamento por papel', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await fixture(db);
  const { asUser, denied, signup } = access(db);
  await db.query(`insert into auth.users(id,raw_user_meta_data,email_confirmed_at)
    values($1,'{"nome":"Responsavel existente","role":"admin"}',now()),
          ($2,'{"nome":"Profissional existente","role":"responsavel"}',now())`,
  [OWNER, LEGACY_PROFESSIONAL]);
  await db.query('insert into public.criancas(id,usuario_id,nome) values($1,$2,$3)', [CHILD, OWNER, 'Paciente existente']);
  await db.query(`insert into public.comunicacoes(usuario_id,crianca_id,pictograma_id,rotulo,categoria)
    values($1,$2,'agua','Água','Necessidades')`, [OWNER, CHILD]);
  await db.query('insert into public.caa_members(crianca_id,professional_id) values($1,$2)', [CHILD, LEGACY_PROFESSIONAL]);
  await db.exec(migrations[2]);

  await t.test('renomeia perfis sem perder IDs, FKs, historico ou vinculos existentes', async () => {
    assert.equal((await db.query("select to_regclass('public.profiles') as old")).rows[0].old, null);
    assert.deepEqual((await db.query('select id,role from public.caa_profiles order by id')).rows,
      [{ id: OWNER, role: 'responsavel' }, { id: LEGACY_PROFESSIONAL, role: 'fonoaudiologo' }]);
    assert.equal((await asUser(LEGACY_PROFESSIONAL, () => db.query('select rotulo from public.caa_events'))).rows[0].rotulo, 'Água');
    const targets = (await db.query(`select count(*)::int as n from pg_constraint
      where confrelid='public.caa_profiles'::regclass and contype='f'`)).rows[0].n;
    assert.ok(targets >= 4);
    assert.equal((await asUser(OWNER, () => db.query('select * from public.list_caa_members($1)', [CHILD]))).rows[0].professional_name, 'Profissional existente');
  });

  await t.test('email exige escolha valida de papel e consentimento booleano no cadastro', async () => {
    for (const role of [null, 'admin', '', 'Fonoaudiólogo']) {
      await denied(signup(INVALID_USER, role), '22023');
    }
    for (const consent of [false, null, 'true']) {
      await denied(signup(INVALID_USER, 'responsavel', true, 'email', { consent }), '22023');
    }
    assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1', [INVALID_USER])).rows[0].n, 0);
    await signup(GUARDIAN, 'responsavel');
    await signup(PROFESSIONAL, 'fonoaudiologo');
    assert.equal((await asUser(GUARDIAN, () => db.query('select role from public.caa_profiles'))).rows[0].role, 'responsavel');
    assert.equal((await asUser(PROFESSIONAL, () => db.query('select role from public.caa_profiles'))).rows[0].role, 'fonoaudiologo');
  });

  await t.test('Google ignora papel alegado nos metadados e exige conclusao do perfil', async () => {
    await signup(GOOGLE, 'fonoaudiologo', true, 'google', { consent: false });
    assert.equal((await asUser(GOOGLE, () => db.query('select role from public.caa_profiles'))).rows[0].role, null);
    assert.deepEqual((await asUser(GOOGLE, () => db.query('select * from public.criancas'))).rows, []);
    await denied(asUser(GOOGLE, () => db.query("insert into public.criancas(nome) values('Negado')")));
    await denied(asUser(GOOGLE, () => db.query("select * from public.redeem_caa_invitation('123456')")));
    await denied(asUser(GOOGLE, () => db.query('select * from public.create_caa_invitation($1)', [CHILD])));
  });

  await t.test('perfil proprio fica disponivel para onboarding sem expor outros perfis', async () => {
    assert.deepEqual((await asUser(GOOGLE, () => db.query('select id from public.caa_profiles'))).rows, [{ id: GOOGLE }]);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select id from public.caa_profiles where id=$1', [OWNER]))).rows, []);
    for (const relation of ['caa_profiles', 'criancas', 'comunicacoes', 'caa_events', 'caa_invitations', 'caa_members']) {
      await denied(asUser(null, () => db.query(`select * from public.${relation}`)));
    }
    await denied(asUser(null, () => db.query("select * from public.complete_caa_profile('responsavel','Anonimo',true,$1)", [GOOGLE])));
  });

  await t.test('clientes nao inserem perfis nem alteram papel, dono ou timestamps', async () => {
    await denied(asUser(GOOGLE, () => db.query("update public.caa_profiles set role='responsavel' where id=$1", [GOOGLE])));
    await denied(asUser(GUARDIAN, () => db.query("update public.caa_profiles set role='fonoaudiologo' where id=$1", [GUARDIAN])));
    await denied(asUser(GUARDIAN, () => db.query('insert into public.caa_profiles(id,nome) values($1,$2)', [INVALID_USER, 'Forjado'])));
    await denied(asUser(GUARDIAN, () => db.query('delete from public.caa_profiles where id=$1', [GUARDIAN])));
    await denied(asUser(GUARDIAN, () => db.query("update public.caa_profiles set created_at=now() where id=$1", [GUARDIAN])));
    await denied(asUser(GUARDIAN, () => db.query('update public.caa_profiles set id=$1 where id=$2', [INVALID_USER, GUARDIAN])));
    assert.deepEqual((await asUser(GUARDIAN, () => db.query("update public.caa_profiles set nome='Alterado' where id=$1 returning nome,role", [GUARDIAN]))).rows,
      [{ nome: 'Alterado', role: 'responsavel' }]);
  });

  await t.test('mudar user_metadata e alegacoes JWT nao altera papel autorizado', async () => {
    await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data || '{\"role\":\"fonoaudiologo\",\"admin\":true}' where id=$1", [GUARDIAN]);
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: GUARDIAN, role: 'authenticated', user_metadata: { role: 'fonoaudiologo' } })]);
    assert.equal((await asUser(GUARDIAN, () => db.query('select role from public.caa_profiles'))).rows[0].role, 'responsavel');
    await denied(asUser(GUARDIAN, () => db.query("select * from public.redeem_caa_invitation('123456')")));
  });

  await t.test('confirmacao de email e exigida no banco mesmo com JWT autenticado', async () => {
    await signup(UNCONFIRMED_GUARDIAN, 'responsavel', false);
    await signup(UNCONFIRMED_PROFESSIONAL, 'fonoaudiologo', false);
    await db.query('insert into public.caa_members(crianca_id,professional_id) values($1,$2)', [CHILD, UNCONFIRMED_PROFESSIONAL]);
    for (const id of [UNCONFIRMED_GUARDIAN, UNCONFIRMED_PROFESSIONAL]) {
      assert.equal((await asUser(id, () => db.query('select id from public.caa_profiles'))).rows.length, 1);
      for (const relation of ['criancas', 'caa_events', 'caa_members', 'caa_invitations']) {
        assert.deepEqual((await asUser(id, () => db.query(`select * from public.${relation}`))).rows, []);
      }
      await denied(asUser(id, () => db.query("insert into public.criancas(nome) values('Negado')")));
      await denied(asUser(id, () => db.query('select * from public.create_caa_invitation($1)', [CHILD])));
      await denied(asUser(id, () => db.query("select * from public.redeem_caa_invitation('123456')")));
    }
  });

  await t.test('onboarding rejeita conta trocada ou identidade esperada ausente sem alterar o perfil', async () => {
    const before = (await asUser(GOOGLE, () => db.query('select * from public.caa_profiles'))).rows[0];
    for (const expected of [GUARDIAN, null]) {
      await denied(asUser(GOOGLE, () => db.query(
        "select * from public.complete_caa_profile('responsavel','Nome de outra conta',true,$1)", [expected],
      )));
    }
    assert.deepEqual((await asUser(GOOGLE, () => db.query('select * from public.caa_profiles'))).rows, [before]);
    assert.equal(before.role, null);
  });

  await t.test('onboarding valida email, papel, nome e consentimento sem escrita parcial', async () => {
    await signup(UNCONFIRMED_GOOGLE, 'responsavel', false, 'google');
    await denied(asUser(UNCONFIRMED_GOOGLE, () => db.query("select * from public.complete_caa_profile('responsavel','Nome',true,$1)", [UNCONFIRMED_GOOGLE])));
    for (const args of [[null, 'Nome', true], ['admin', 'Nome', true], ['responsavel', '', true], ['responsavel', 'N'.repeat(81), true], ['responsavel', 'Nome', false], ['responsavel', 'Nome', null]]) {
      await denied(asUser(GOOGLE, () => db.query('select * from public.complete_caa_profile($1,$2,$3,$4)', [...args, GOOGLE])), '22023');
    }
    assert.equal((await asUser(GOOGLE, () => db.query('select role from public.caa_profiles'))).rows[0].role, null);
    const profile = (await asUser(GOOGLE, () => db.query("select * from public.complete_caa_profile('fonoaudiologo','  Nome Google  ',true,$1)", [GOOGLE]))).rows[0];
    assert.equal(profile.id, GOOGLE);
    assert.equal(profile.nome, 'Nome Google');
    assert.equal(profile.role, 'fonoaudiologo');
    await denied(asUser(GOOGLE, () => db.query("select * from public.complete_caa_profile('responsavel','Outro',true,$1)", [GOOGLE])));
    await denied(asUser(GUARDIAN, () => db.query("select * from public.complete_caa_profile('fonoaudiologo','Outro',true,$1)", [GUARDIAN])));
    assert.equal((await asUser(GOOGLE, () => db.query('select role from public.caa_profiles'))).rows[0].role, 'fonoaudiologo');
  });

  await t.test('responsavel confirmado gerencia somente suas criancas e comunicacoes', async () => {
    await asUser(GUARDIAN, () => db.query('insert into public.criancas(id,nome) values($1,$2)', [OTHER_CHILD, 'Paciente novo']));
    await asUser(GUARDIAN, () => db.query(`insert into public.comunicacoes(crianca_id,pictograma_id,rotulo,categoria)
      values($1,'ajuda','Ajuda','Necessidades')`, [OTHER_CHILD]));
    assert.deepEqual((await asUser(GUARDIAN, () => db.query('select id from public.criancas'))).rows, [{ id: OTHER_CHILD }]);
    assert.deepEqual((await asUser(GUARDIAN, () => db.query('select rotulo from public.caa_events'))).rows, [{ rotulo: 'Ajuda' }]);
    await denied(asUser(GUARDIAN, () => db.query("insert into public.criancas(usuario_id,nome) values($1,'Forjado')", [OWNER])));
    assert.deepEqual((await asUser(GUARDIAN, () => db.query("update public.criancas set nome='Forjado' where id=$1 returning id", [CHILD]))).rows, []);
    assert.deepEqual((await asUser(GUARDIAN, () => db.query('delete from public.comunicacoes where crianca_id=$1 returning id', [CHILD]))).rows, []);
  });

  let invite;
  await t.test('somente responsavel confirmado gera convites para o proprio paciente', async () => {
    invite = (await asUser(OWNER, () => db.query('select * from public.create_caa_invitation($1)', [CHILD]))).rows[0];
    assert.match(invite.code, /^[0-9]{6}$/);
    await denied(asUser(GUARDIAN, () => db.query('select * from public.create_caa_invitation($1)', [CHILD])));
    for (const id of [PROFESSIONAL, GOOGLE]) {
      await denied(asUser(id, () => db.query('select * from public.create_caa_invitation($1)', [CHILD])));
      await denied(asUser(id, () => db.query('select * from public.list_caa_members($1)', [CHILD])));
      await denied(asUser(id, () => db.query('select public.revoke_caa_member($1,$2)', [CHILD, LEGACY_PROFESSIONAL])));
    }
  });

  await t.test('somente fono confirmado resgata e consulta apenas pacientes vinculados', async () => {
    await denied(asUser(GUARDIAN, () => db.query('select * from public.redeem_caa_invitation($1)', [invite.code])));
    assert.equal((await db.query('select is_used from public.caa_invitations where id=$1', [invite.id])).rows[0].is_used, false);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select * from public.caa_events'))).rows, []);
    const redemption = (await asUser(PROFESSIONAL, () => db.query('select * from public.redeem_caa_invitation($1)', [invite.code]))).rows[0];
    assert.equal(redemption.status, 'linked');
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select id from public.criancas'))).rows, [{ id: CHILD }]);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select rotulo from public.caa_events'))).rows, [{ rotulo: 'Água' }]);
    assert.deepEqual((await asUser(GOOGLE, () => db.query('select * from public.caa_events'))).rows, []);
    assert.equal((await asUser(OWNER, () => db.query('select * from public.list_caa_members($1)', [CHILD]))).rows.length, 3);
  });

  await t.test('fono nao escreve na prancha nem altera ou exclui dados do paciente', async () => {
    await denied(asUser(PROFESSIONAL, () => db.query("insert into public.criancas(nome) values('Propria')")));
    await denied(asUser(PROFESSIONAL, () => db.query(`insert into public.comunicacoes
      (usuario_id,crianca_id,pictograma_id,rotulo,categoria) values($1,$2,'x','Forjado','Teste')`, [OWNER, CHILD])));
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query("update public.criancas set nome='Forjado' where id=$1 returning id", [CHILD]))).rows, []);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('delete from public.criancas where id=$1 returning id', [CHILD]))).rows, []);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('delete from public.comunicacoes returning id'))).rows, []);
    await denied(asUser(PROFESSIONAL, () => db.query("update public.caa_events set rotulo='Forjado'")));
  });

  await t.test('papel de responsavel nao ganha acesso profissional por vinculo forjado', async () => {
    await db.query('insert into public.caa_members(crianca_id,professional_id) values($1,$2)', [CHILD, GUARDIAN]);
    assert.deepEqual((await asUser(GUARDIAN, () => db.query('select id from public.criancas where id=$1', [CHILD]))).rows, []);
    assert.deepEqual((await asUser(GUARDIAN, () => db.query('select * from public.caa_events where crianca_id=$1', [CHILD]))).rows, []);
    assert.deepEqual((await asUser(GUARDIAN, () => db.query('select * from public.caa_members where crianca_id=$1', [CHILD]))).rows, []);
  });

  await t.test('revogacao e perda de confirmacao retiram leitura imediatamente', async () => {
    assert.equal((await asUser(OWNER, () => db.query('select public.revoke_caa_member($1,$2) as removed', [CHILD, PROFESSIONAL]))).rows[0].removed, true);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select * from public.caa_events'))).rows, []);
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [LEGACY_PROFESSIONAL]);
    assert.deepEqual((await asUser(LEGACY_PROFESSIONAL, () => db.query('select * from public.caa_events'))).rows, []);
    assert.deepEqual((await asUser(LEGACY_PROFESSIONAL, () => db.query('select * from public.caa_members'))).rows, []);
  });

  await t.test('funcao de gatilho e tabelas privadas continuam inacessiveis ao cliente', async () => {
    await denied(asUser(GUARDIAN, () => db.query('select comunica_react_private.handle_new_user()')));
    await denied(asUser(GUARDIAN, () => db.query('select * from comunica_links_private.redemption_attempts')));
    await denied(asUser(null, () => db.query("select comunica_react_private.has_role('responsavel')")));
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.caa_profiles'::regclass")).rows[0].relrowsecurity, true);
  });
});

test('migracao de papeis recusa caa_profiles legado sem alterar dados', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await fixture(db);
  await db.exec("create table public.caa_profiles(legacy text); insert into public.caa_profiles values('preservado')");
  await assert.rejects(db.exec(migrations[2]), /caa_profiles already exists/);
  await db.exec('rollback');
  assert.deepEqual((await db.query('select * from public.caa_profiles')).rows, [{ legacy: 'preservado' }]);
  assert.notEqual((await db.query("select to_regclass('public.profiles') as relation")).rows[0].relation, null);
});

test('migracao recusa conta legada com papeis conflitantes sem remover vinculos', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await fixture(db);
  await db.query('insert into auth.users(id) values($1),($2)', [OWNER, LEGACY_PROFESSIONAL]);
  await db.query('insert into public.criancas(id,usuario_id,nome) values($1,$2,$3),($4,$5,$6)',
    [CHILD, OWNER, 'Paciente A', OTHER_CHILD, LEGACY_PROFESSIONAL, 'Paciente B']);
  await db.query('insert into public.caa_members(crianca_id,professional_id) values($1,$2)', [CHILD, LEGACY_PROFESSIONAL]);
  await assert.rejects(db.exec(migrations[2]), /both guardian and professional data/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from public.criancas')).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from public.caa_members')).rows[0].n, 1);
  assert.equal((await db.query("select to_regclass('public.caa_profiles') as relation")).rows[0].relation, null);
});

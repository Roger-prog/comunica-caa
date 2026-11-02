import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const PROFESSIONAL = '33333333-3333-4333-8333-333333333333';
const SECOND_PROFESSIONAL = '44444444-4444-4444-8444-444444444444';
const ATTACKER = '55555555-5555-4555-8555-555555555555';
const CHILD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const migrations = await Promise.all(['001_initial_schema.sql', '002_professional_links.sql'].map((name) =>
  readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));

async function authFixture(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
}

test('PostgreSQL: convites, resgate atomico e acesso profissional por vinculo', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await authFixture(db);
  await db.exec(migrations[0]);
  for (const [id, nome] of [[OWNER_A, 'Responsavel A'], [OWNER_B, 'Responsavel B'],
    [PROFESSIONAL, 'Profissional A'], [SECOND_PROFESSIONAL, 'Profissional B'], [ATTACKER, 'Sem vinculo']]) {
    await db.query('insert into auth.users values ($1,$2)', [id, { nome, role: 'admin' }]);
  }
  await db.query('insert into public.criancas (id,usuario_id,nome) values ($1,$2,$3),($4,$5,$6)',
    [CHILD_A, OWNER_A, 'Paciente A', CHILD_B, OWNER_B, 'Paciente B']);
  // Historical records exist before the new migration; caa_events must reuse them.
  await db.query(`insert into public.comunicacoes (usuario_id,crianca_id,pictograma_id,rotulo,categoria)
    values ($1,$2,'agua','Água','Necessidades'),($3,$4,'ajuda','Ajuda','Necessidades')`,
  [OWNER_A, CHILD_A, OWNER_B, CHILD_B]);
  await db.exec(migrations[1]);

  async function asUser(id, callback) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try { return await callback(); } finally { await db.exec('reset role'); }
  }
  const denied = (promise, code = '42501') => assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
  const create = async (owner = OWNER_A, child = CHILD_A) =>
    (await asUser(owner, () => db.query('select * from public.create_caa_invitation($1)', [child]))).rows[0];
  const redeem = async (user, code) =>
    (await asUser(user, () => db.query('select * from public.redeem_caa_invitation($1)', [code]))).rows[0];
  let invite;

  await t.test('anonimos nao acessam tabelas, view ou RPCs', async () => {
    for (const relation of ['caa_invitations', 'caa_members', 'caa_events']) {
      await denied(asUser(null, () => db.query(`select * from public.${relation}`)));
    }
    await denied(asUser(null, () => db.query('select * from public.create_caa_invitation($1)', [CHILD_A])));
    await denied(asUser(null, () => db.query("select * from public.redeem_caa_invitation('123456')")));
    await denied(asUser(null, () => db.query('select * from public.list_caa_members($1)', [CHILD_A])));
  });

  await t.test('responsavel cria codigo numerico com seis digitos e prazo exato de 24h', async () => {
    invite = await create();
    assert.equal(invite.crianca_id, CHILD_A);
    assert.match(invite.code, /^[0-9]{6}$/);
    assert.equal(invite.is_used, false);
    assert.equal(invite.expires_at.getTime() - invite.created_at.getTime(), 24 * 60 * 60 * 1000);
    assert.ok(Math.abs(Date.now() - invite.created_at.getTime()) < 10_000);
    assert.equal((await asUser(OWNER_A, () => db.query('select code from public.caa_invitations'))).rows[0].code, invite.code);
    for (const user of [OWNER_B, PROFESSIONAL, SECOND_PROFESSIONAL, ATTACKER]) {
      assert.deepEqual((await asUser(user, () => db.query('select * from public.caa_invitations'))).rows, []);
    }
  });

  await t.test('clientes nao geram convite alheio nem forjam codigo, prazo ou vinculo', async () => {
    await denied(create(OWNER_B, CHILD_A));
    await denied(create(PROFESSIONAL, CHILD_A));
    await denied(asUser(OWNER_A, () => db.query("insert into public.caa_invitations (crianca_id,code) values ($1,'123456')", [CHILD_B])));
    await denied(asUser(OWNER_A, () => db.query('update public.caa_invitations set is_used=false, expires_at=now()+interval \'1 year\'')));
    await denied(asUser(PROFESSIONAL, () => db.query('insert into public.caa_members (crianca_id,professional_id) values ($1,$2)', [CHILD_A, PROFESSIONAL])));
    await denied(asUser(PROFESSIONAL, () => db.query('select * from comunica_links_private.redemption_attempts')));
  });

  await t.test('regeneracao substitui o codigo anterior sem criar convites duplicados', async () => {
    const previous = invite;
    invite = await create();
    assert.equal(invite.id, previous.id);
    assert.notEqual(invite.code, previous.code);
    assert.equal((await db.query('select count(*)::integer as n from public.caa_invitations')).rows[0].n, 1);
    assert.deepEqual(await redeem(PROFESSIONAL, previous.code), { status: 'invalid', crianca_id: null, retry_after_seconds: 0 });
  });

  await t.test('resgate cria um vinculo e consome o convite na mesma transacao', async () => {
    assert.deepEqual(await redeem(PROFESSIONAL, invite.code), { status: 'linked', crianca_id: CHILD_A, retry_after_seconds: 0 });
    assert.equal((await db.query('select is_used from public.caa_invitations')).rows[0].is_used, true);
    assert.equal((await db.query('select count(*)::integer as n from public.caa_members')).rows[0].n, 1);
    assert.equal((await redeem(SECOND_PROFESSIONAL, invite.code)).status, 'invalid');
    assert.equal((await redeem(PROFESSIONAL, invite.code)).status, 'invalid');
    assert.equal((await db.query('select count(*)::integer as n from public.caa_members')).rows[0].n, 1);
    const functionSql = (await db.query("select pg_get_functiondef('public.redeem_caa_invitation(text)'::regprocedure) as sql")).rows[0].sql;
    assert.match(functionSql, /for update/i);
  });

  await t.test('profissional le apenas o paciente e historico vinculados, incluindo dados antigos', async () => {
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select id from public.criancas'))).rows, [{ id: CHILD_A }]);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select rotulo from public.caa_events'))).rows, [{ rotulo: 'Água' }]);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select rotulo from public.comunicacoes'))).rows, [{ rotulo: 'Água' }]);
    assert.deepEqual((await asUser(ATTACKER, () => db.query('select * from public.caa_events'))).rows, []);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select * from public.profiles where id=$1', [OWNER_A]))).rows, []);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select * from public.caa_invitations'))).rows, []);
    const view = (await db.query("select reloptions from pg_class where oid='public.caa_events'::regclass")).rows[0];
    assert.ok(view.reloptions.includes('security_invoker=true'));
  });

  await t.test('vinculo profissional nao concede alteracao ou exclusao dos dados do responsavel', async () => {
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query("update public.criancas set nome='Forjado' where id=$1 returning id", [CHILD_A]))).rows, []);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('delete from public.criancas where id=$1 returning id', [CHILD_A]))).rows, []);
    await denied(asUser(PROFESSIONAL, () => db.query(`insert into public.comunicacoes
      (usuario_id,crianca_id,pictograma_id,rotulo,categoria) values ($1,$2,'x','Forjado','Teste')`, [OWNER_A, CHILD_A])));
    await denied(asUser(PROFESSIONAL, () => db.query("update public.caa_events set rotulo='Forjado'")));
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('delete from public.comunicacoes returning id'))).rows, []);
    await denied(asUser(PROFESSIONAL, () => db.query('delete from public.caa_members')));
  });

  await t.test('somente o responsavel lista os nomes e revoga o acesso', async () => {
    const list = (await asUser(OWNER_A, () => db.query('select * from public.list_caa_members($1)', [CHILD_A]))).rows;
    assert.equal(list.length, 1);
    assert.equal(list[0].professional_id, PROFESSIONAL);
    assert.equal(list[0].professional_name, 'Profissional A');
    await denied(asUser(PROFESSIONAL, () => db.query('select * from public.list_caa_members($1)', [CHILD_A])));
    await denied(asUser(OWNER_B, () => db.query('select public.revoke_caa_member($1,$2)', [CHILD_A, PROFESSIONAL])));
  });

  await t.test('novo convite de profissional ja vinculado e consumido sem duplicar membro', async () => {
    invite = await create();
    assert.equal((await redeem(PROFESSIONAL, invite.code)).status, 'already_linked');
    assert.equal((await db.query('select count(*)::integer as n from public.caa_members')).rows[0].n, 1);
    assert.equal((await db.query('select is_used from public.caa_invitations')).rows[0].is_used, true);
    // Successful requests cannot clear the guessing limit accumulated earlier.
    assert.equal((await db.query('select failed_attempts from comunica_links_private.redemption_attempts where user_id=$1', [PROFESSIONAL])).rows[0].failed_attempts, 2);
  });

  await t.test('convite vencido ou do proprio responsavel e rejeitado sem consumir', async () => {
    invite = await create();
    await db.query("update public.caa_invitations set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=$1", [invite.id]);
    assert.equal((await redeem(SECOND_PROFESSIONAL, invite.code)).status, 'invalid');
    invite = await create();
    assert.equal((await redeem(OWNER_A, invite.code)).status, 'invalid');
    assert.equal((await db.query('select is_used from public.caa_invitations')).rows[0].is_used, false);
  });

  await t.test('zeros iniciais sao preservados e outro profissional pode receber novo convite', async () => {
    await db.query("update public.caa_invitations set code='000042' where id=$1", [invite.id]);
    assert.equal((await redeem(SECOND_PROFESSIONAL, '000042')).status, 'linked');
    assert.equal((await db.query('select count(*)::integer as n from public.caa_members')).rows[0].n, 2);
  });

  await t.test('revogacao remove acesso imediatamente sem afetar o outro profissional', async () => {
    const revoked = await asUser(OWNER_A, () => db.query('select public.revoke_caa_member($1,$2) as revoked', [CHILD_A, PROFESSIONAL]));
    assert.equal(revoked.rows[0].revoked, true);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select * from public.caa_events'))).rows, []);
    assert.deepEqual((await asUser(PROFESSIONAL, () => db.query('select id from public.criancas'))).rows, []);
    assert.equal((await asUser(SECOND_PROFESSIONAL, () => db.query('select * from public.caa_events'))).rows.length, 1);
    assert.equal((await asUser(OWNER_A, () => db.query('select * from public.caa_events'))).rows.length, 1);
  });

  await t.test('cinco falhas bloqueiam novas tentativas por 15 minutos sem rollback do contador', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await redeem(ATTACKER, 'not-a-code');
      assert.equal(result.status, attempt < 5 ? 'invalid' : 'rate_limited');
      assert.equal(result.crianca_id, null);
      if (attempt === 5) assert.ok(result.retry_after_seconds > 0 && result.retry_after_seconds <= 900);
    }
    assert.equal((await db.query('select failed_attempts from comunica_links_private.redemption_attempts where user_id=$1', [ATTACKER])).rows[0].failed_attempts, 5);
    invite = await create();
    assert.equal((await redeem(ATTACKER, invite.code)).status, 'rate_limited');
    assert.equal((await db.query('select is_used from public.caa_invitations')).rows[0].is_used, false);
    await db.query("update comunica_links_private.redemption_attempts set window_started_at=now()-interval '16 minutes' where user_id=$1", [ATTACKER]);
    assert.equal((await redeem(ATTACKER, invite.code)).status, 'linked');
  });

  await t.test('restricoes SQL e timestamps nao podem ser contornados pelo cliente', async () => {
    await denied(asUser(OWNER_A, () => db.query("insert into public.caa_members (crianca_id,professional_id,created_at) values ($1,$2,'2000-01-01')", [CHILD_A, PROFESSIONAL])));
    await denied(db.query("update public.caa_invitations set code='12345' where id=$1", [invite.id]), '23514');
    await denied(db.query("update public.caa_invitations set expires_at=created_at where id=$1", [invite.id]), '23514');
  });

  await t.test('excluir paciente elimina convites, vinculos e eventos sem afetar outros pacientes', async () => {
    await asUser(OWNER_A, () => db.query('delete from public.criancas where id=$1', [CHILD_A]));
    for (const relation of ['caa_invitations', 'caa_members', 'caa_events']) {
      assert.equal((await db.query(`select * from public.${relation} where crianca_id=$1`, [CHILD_A])).rows.length, 0);
    }
    assert.equal((await asUser(OWNER_B, () => db.query('select * from public.caa_events'))).rows.length, 1);
  });
});

test('migracao profissional recusa nomes caa_* legados sem apagar dados', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await authFixture(db);
  await db.exec(migrations[0]);
  await db.exec("create table public.caa_members (legacy text); insert into public.caa_members values ('preservado')");
  await assert.rejects(db.exec(migrations[1]), /CAA relation names already exist/);
  await db.exec('rollback');
  assert.deepEqual((await db.query('select * from public.caa_members')).rows, [{ legacy: 'preservado' }]);
  assert.equal((await db.query("select to_regclass('public.caa_invitations') as relation")).rows[0].relation, null);
});

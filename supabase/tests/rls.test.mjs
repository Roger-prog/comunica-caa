import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const EXISTING_USER = '33333333-3333-4333-8333-333333333333';
const CHILD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EVENT_B = 'bbbbbbbb-2222-4222-8222-222222222222';

test('PostgreSQL: grants, triggers e isolamento RLS entre usuarios', async (t) => {
  // PostgreSQL real em WASM; somente o esquema de Auth e a sessao JWT sao fixtures.
  // Nenhuma conexao ao Supabase remoto e realizada.
  const db = new PGlite();
  t.after(() => db.close());

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [
    EXISTING_USER, { name: 'Perfil existente' },
  ]);
  await db.exec(await readFile(
    new URL('../migrations/001_initial_schema.sql', import.meta.url), 'utf8',
  ));

  async function asUser(id, callback) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try {
      return await callback();
    } finally {
      await db.exec('reset role');
    }
  }
  const denied = (promise, code = '42501') => assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });

  await t.test('backfill cria perfil de Auth existente sem importar criancas', async () => {
    const { rows } = await db.query('select nome from public.profiles where id=$1', [EXISTING_USER]);
    assert.equal(rows[0].nome, 'Perfil existente');
    assert.equal((await db.query('select count(*)::int as n from public.criancas')).rows[0].n, 0);
  });

  await t.test('trigger cria perfis e limita metadados sem conceder privilegios', async () => {
    await db.query('insert into auth.users values ($1, $2), ($3, $4)', [
      USER_A, { nome: '  Responsavel A  ', role: 'admin' },
      USER_B, { nome: 'B'.repeat(100) },
    ]);
    const a = (await asUser(USER_A, () => db.query('select * from public.profiles'))).rows;
    const b = (await asUser(USER_B, () => db.query('select * from public.profiles'))).rows;
    assert.equal(a.length, 1);
    assert.equal(a[0].nome, 'Responsavel A');
    assert.equal(b.length, 1);
    assert.equal(b[0].nome.length, 80);
    assert.equal('role' in a[0], false);
  });

  await t.test('RLS esta habilitada em todas as tabelas de aplicacao', async () => {
    const { rows } = await db.query(`
      select relname, relrowsecurity from pg_class
      where relnamespace='public'::regnamespace
        and relname in ('profiles', 'criancas', 'comunicacoes')
    `);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.relrowsecurity));
  });

  await t.test('anonimos nao podem ler ou gravar dados', async () => {
    for (const table of ['profiles', 'criancas', 'comunicacoes']) {
      await denied(asUser(null, () => db.query(`select * from public.${table}`)));
    }
    await denied(asUser(null, () => db.query('insert into public.criancas (nome) values ($1)', ['Negado'])));
  });

  await t.test('perfil de outro usuario e invisivel e nao pode ser atualizado', async () => {
    assert.deepEqual((await asUser(USER_A, () => db.query('select id from public.profiles where id=$1', [USER_B]))).rows, []);
    const result = await asUser(USER_A, () => db.query("update public.profiles set nome='Invadido' where id=$1 returning id", [USER_B]));
    assert.equal(result.rows.length, 0);
    await denied(asUser(USER_A, () => db.query('insert into public.profiles (id,nome) values ($1,$2)', [USER_B, 'Forjado'])));
    await denied(asUser(USER_A, () => db.query('delete from public.profiles where id=$1', [USER_A])));
  });

  await t.test('atualizacao do proprio perfil permite somente nome', async () => {
    const original = (await asUser(USER_A, () => db.query('select * from public.profiles'))).rows[0];
    const updated = (await asUser(USER_A, () => db.query("update public.profiles set nome='Nome atualizado' where id=$1 returning *", [USER_A]))).rows[0];
    assert.equal(updated.nome, 'Nome atualizado');
    assert.equal(updated.created_at.toISOString(), original.created_at.toISOString());
    assert.ok(updated.updated_at >= original.updated_at);
    await denied(asUser(USER_A, () => db.query('update public.profiles set id=$1 where id=$2', [USER_B, USER_A])));
    await denied(asUser(USER_A, () => db.query("update public.profiles set created_at='2000-01-01' where id=$1", [USER_A])));
  });

  await t.test('cada usuario cria e lista somente as proprias criancas', async () => {
    await asUser(USER_A, () => db.query('insert into public.criancas (id,nome) values ($1,$2)', [CHILD_A, 'Crianca A']));
    await asUser(USER_B, () => db.query('insert into public.criancas (id,nome) values ($1,$2)', [CHILD_B, 'Crianca B']));
    const a = (await asUser(USER_A, () => db.query('select * from public.criancas'))).rows;
    const b = (await asUser(USER_B, () => db.query('select * from public.criancas'))).rows;
    assert.deepEqual(a.map((row) => row.id), [CHILD_A]);
    assert.deepEqual(b.map((row) => row.id), [CHILD_B]);
    assert.equal(a[0].usuario_id, USER_A);
  });

  await t.test('insercao falsificada de proprietario e rejeitada', async () => {
    await denied(asUser(USER_A, () => db.query('insert into public.criancas (usuario_id,nome) values ($1,$2)', [USER_B, 'Forjada'])));
    await denied(asUser(USER_A, () => db.query('insert into public.criancas (nome,created_at) values ($1,now())', ['Data forjada'])));
  });

  await t.test('troca de proprietario e atualizacao de crianca alheia sao bloqueadas', async () => {
    await denied(asUser(USER_A, () => db.query('update public.criancas set usuario_id=$1 where id=$2', [USER_B, CHILD_A])));
    const foreignUpdate = await asUser(USER_A, () => db.query("update public.criancas set nome='Invadida' where id=$1 returning id", [CHILD_B]));
    const foreignDelete = await asUser(USER_A, () => db.query('delete from public.criancas where id=$1 returning id', [CHILD_B]));
    assert.equal(foreignUpdate.rows.length, 0);
    assert.equal(foreignDelete.rows.length, 0);
    const renamed = (await asUser(USER_A, () => db.query("update public.criancas set nome='Crianca A atualizada' where id=$1 returning nome", [CHILD_A]))).rows[0];
    assert.equal(renamed.nome, 'Crianca A atualizada');
  });

  await t.test('eventos sao isolados por usuario e guardam o rotulo utilizado', async () => {
    await asUser(USER_A, () => db.query(`
      insert into public.comunicacoes (id,crianca_id,pictograma_id,rotulo,categoria)
      values ($1,$2,'agua','Agua','Necessidades')
    `, [EVENT_A, CHILD_A]));
    await asUser(USER_B, () => db.query(`
      insert into public.comunicacoes (id,crianca_id,pictograma_id,rotulo,categoria)
      values ($1,$2,'ajuda','Ajuda','Necessidades')
    `, [EVENT_B, CHILD_B]));
    const a = (await asUser(USER_A, () => db.query('select * from public.comunicacoes'))).rows;
    const b = (await asUser(USER_B, () => db.query('select * from public.comunicacoes'))).rows;
    assert.deepEqual(a.map((row) => row.id), [EVENT_A]);
    assert.deepEqual(b.map((row) => row.id), [EVENT_B]);
    assert.equal(a[0].rotulo, 'Agua');
    assert.equal(a[0].usuario_id, USER_A);
  });

  await t.test('FK composta rejeita evento com crianca de outro proprietario', async () => {
    await denied(asUser(USER_A, () => db.query(`
      insert into public.comunicacoes (crianca_id,pictograma_id,rotulo,categoria)
      values ($1,'agua','Agua','Necessidades')
    `, [CHILD_B])), '23503');
    await denied(asUser(USER_A, () => db.query(`
      insert into public.comunicacoes (usuario_id,crianca_id,pictograma_id,rotulo,categoria)
      values ($1,$2,'agua','Agua','Necessidades')
    `, [USER_B, CHILD_B])));
  });

  await t.test('eventos nao podem ser reescritos e timestamps nao podem ser forjados', async () => {
    await denied(asUser(USER_A, () => db.query("update public.comunicacoes set rotulo='Forjado' where id=$1", [EVENT_A])));
    await denied(asUser(USER_A, () => db.query(`
      insert into public.comunicacoes (crianca_id,pictograma_id,rotulo,categoria,created_at)
      values ($1,'agua','Agua','Necessidades','2000-01-01')
    `, [CHILD_A])));
    const result = await asUser(USER_A, () => db.query('delete from public.comunicacoes where id=$1 returning id', [EVENT_B]));
    assert.equal(result.rows.length, 0);
  });

  await t.test('restricoes rejeitam nomes e eventos vazios', async () => {
    await denied(asUser(USER_A, () => db.query("insert into public.criancas (nome) values ('   ')")), '23514');
    await denied(asUser(USER_A, () => db.query(`
      insert into public.comunicacoes (crianca_id,pictograma_id,rotulo,categoria)
      values ($1,'agua','','Necessidades')
    `, [CHILD_A])), '23514');
  });

  await t.test('funcoes privadas nao podem ser invocadas pelo cliente', async () => {
    const { rows } = await db.query(`
      select has_schema_privilege('authenticated','comunica_react_private','USAGE') as schema_access,
        has_function_privilege('authenticated','comunica_react_private.handle_new_user()','EXECUTE') as execute_access
    `);
    assert.equal(rows[0].schema_access, false);
    assert.equal(rows[0].execute_access, false);
    await denied(asUser(USER_A, () => db.query('select comunica_react_private.handle_new_user()')));
  });

  await t.test('exclusao da propria crianca remove somente seu historico', async () => {
    await asUser(USER_A, () => db.query('delete from public.criancas where id=$1', [CHILD_A]));
    assert.equal((await asUser(USER_A, () => db.query('select * from public.comunicacoes'))).rows.length, 0);
    assert.equal((await asUser(USER_B, () => db.query('select * from public.comunicacoes'))).rows.length, 1);
  });

  await t.test('exclusao administrativa de Auth propaga para perfil, criancas e eventos', async () => {
    await db.query('delete from auth.users where id=$1', [USER_B]);
    for (const table of ['profiles', 'criancas', 'comunicacoes']) {
      const column = table === 'profiles' ? 'id' : 'usuario_id';
      const { rows } = await db.query(`select * from public.${table} where ${column}=$1`, [USER_B]);
      assert.equal(rows.length, 0);
    }
    assert.equal((await db.query('select * from public.profiles where id=$1', [EXISTING_USER])).rows.length, 1);
  });
});

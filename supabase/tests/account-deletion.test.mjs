import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SUCCESSOR = '22222222-2222-4222-8222-222222222222';
const SOLE_GUARDIAN = '33333333-3333-4333-8333-333333333333';
const EMPTY = '44444444-4444-4444-8444-444444444444';
const STORAGE_OWNER = '55555555-5555-4555-8555-555555555555';
const PROFESSIONAL = '66666666-6666-4666-8666-666666666666';
const SHARED_CHILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOLE_CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECORDING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STALE_SESSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BUCKET = 'caa-symbol-images';
const PHOTO = `${SHARED_CHILD}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp`;
const AUDIO = '1a45dfa30102030405060708';

const migrationFolder = new URL('../migrations/', import.meta.url);
const throughAccountDeletion = (await readdir(migrationFolder))
  .filter((name) => /^\d+_.*\.sql$/.test(name) && Number(name.split('_')[0]) <= 14)
  .sort();
const migrations = await Promise.all(throughAccountDeletion.map(
  (name) => readFile(new URL(name, migrationFolder), 'utf8'),
));

async function fixture(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text unique,
      raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{"provider":"email"}',
      email_confirmed_at timestamptz
    );
    create table auth.sessions (
      id uuid primary key, user_id uuid not null references auth.users on delete cascade,
      created_at timestamptz not null default now()
    );
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;

    create schema storage;
    create table storage.buckets (
      id text primary key, name text unique not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      bucket_id text references storage.buckets, name text, metadata jsonb,
      owner_id text, owner uuid references auth.users on delete restrict,
      primary key (bucket_id,name)
    );
    create function storage.allow_any_operation(text[]) returns boolean
    language sql stable as $$
      select coalesce(current_setting('storage.operation', true) = any($1), false)
    $$;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
    alter table storage.objects enable row level security;
    alter table storage.buckets enable row level security;
    create policy mock_permissive_storage on storage.objects for all using (true) with check (true);
    create policy mock_permissive_bucket on storage.buckets for all using (true) with check (true);
  `);
  for (const migration of migrations) await db.exec(migration);

  for (const [id, name, role] of [
    [OWNER, 'Titular', 'responsavel'], [SUCCESSOR, 'Corresponsável autorizado', 'responsavel'],
    [SOLE_GUARDIAN, 'Responsável único', 'responsavel'], [EMPTY, 'Sem pacientes', 'responsavel'],
    [STORAGE_OWNER, 'Com arquivos', 'responsavel'], [PROFESSIONAL, 'Profissional', 'fonoaudiologo'],
  ]) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
      values ($1,$2,$3,now())`, [id, `${id}@example.test`, { nome: name, role, consent: true }]);
    await db.query('insert into auth.sessions (id,user_id) values ($1,$1)', [id]);
  }
  await db.query("insert into auth.sessions (id,user_id,created_at) values ($1,$2,now()-interval '11 minutes')",
    [STALE_SESSION, EMPTY]);
  await db.query('insert into public.criancas (id,usuario_id,nome) values ($1,$2,$3), ($4,$5,$6)',
    [SHARED_CHILD, OWNER, 'Criança compartilhada', SOLE_CHILD, SOLE_GUARDIAN, 'Criança sem sucessor']);
  await db.query('insert into public.caa_guardian_members (crianca_id,guardian_id,can_edit,can_manage_links) values ($1,$2,true,true)',
    [SHARED_CHILD, SUCCESSOR]);
  await db.query('insert into public.caa_members (crianca_id,professional_id,board_access,approved_at) values ($1,$2,true,now())',
    [SHARED_CHILD, PROFESSIONAL]);
  await db.query(`insert into public.comunicacoes (crianca_id,usuario_id,pictograma_id,rotulo,categoria)
    values ($1,$2,'agua','Água','Necessidades')`, [SHARED_CHILD, OWNER]);
  await db.query('insert into public.caa_board_settings (crianca_id,settings) values ($1,$2)',
    [SHARED_CHILD, { pageSize: 16, categoryImages: { animais: 2517 } }]);
  await db.query(`insert into comunica_board_private.symbol_images (path,crianca_id,guardian_id,uploaded_by,state)
    values ($1,$2,$3,$3,'attached')`, [PHOTO, SHARED_CHILD, OWNER]);
  await db.query('insert into storage.objects (bucket_id,name,metadata) values ($1,$2,$3)',
    [BUCKET, PHOTO, { size: 1224, mimetype: 'image/webp' }]);
  await db.query(`insert into public.caa_custom_symbols (crianca_id,created_by,label,speech_text,categories,image_path)
    values ($1,$2,'Foto da família','Família',array['pessoas'],$3)`, [SHARED_CHILD, OWNER, PHOTO]);
  await db.query(`insert into comunica_pronunciation_private.recordings
    (id,crianca_id,captured_by,practice,mime_type,audio,created_at,expires_at)
    values ($1,$2,$3,'Água','audio/webm',decode($4,'hex'),now(),now()+interval '30 days')`,
  [RECORDING, SHARED_CHILD, OWNER, AUDIO]);
  await db.query(`insert into comunica_pronunciation_private.notes (recording_id,author_id,observation)
    values ($1,$2,'Observação profissional')`, [RECORDING, PROFESSIONAL]);
}

test('PostgreSQL: exclusão de conta com autenticação recente e preservação dos pacientes', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await fixture(db);

  async function asUser(id, callback, session = id) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session })]);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try { return await callback(); } finally { await db.exec('reset role'); }
  }
  const preview = async (id, expected = id, session = id) => asUser(id, async () =>
    (await db.query('select * from public.preview_caa_account_deletion($1)', [expected])).rows[0], session);
  const confirm = async (id, plan, { expected = id, session = id, literal = 'EXCLUIR' } = {}) =>
    asUser(id, async () => (await db.query('select public.confirm_caa_account_deletion($1,$2,$3,$4) as outcome',
      [expected, literal, JSON.stringify(plan.patients), plan.review_reason])).rows[0].outcome, session);
  const exists = async (id) => (await db.query('select id from auth.users where id=$1', [id])).rows.length === 1;

  await t.test('nega outra identidade, sessão antiga e sessão de outra conta', async () => {
    const plan = await preview(EMPTY, EMPTY, STALE_SESSION);
    assert.deepEqual(plan, { patients: [], review_reason: null, review_requested_at: null, reauth_required: true });
    await assert.rejects(preview(null, EMPTY), { code: '42501' });
    await assert.rejects(preview(SUCCESSOR, EMPTY), { code: '42501' });
    await assert.rejects(confirm(SUCCESSOR, plan, { expected: EMPTY }), { code: '42501' });
    assert.equal(await confirm(EMPTY, plan, { session: STALE_SESSION }), 'reauth_required');
    assert.equal(await confirm(EMPTY, plan, { session: SUCCESSOR }), 'reauth_required');
    assert.equal(await exists(EMPTY), true);
  });

  await t.test('exige a confirmação literal e exclui a conta sem dependências', async () => {
    const plan = await preview(EMPTY);
    assert.deepEqual(plan, { patients: [], review_reason: null, review_requested_at: null, reauth_required: false });
    await assert.rejects(confirm(EMPTY, plan, { literal: 'Excluir' }), { code: '22023' });
    await assert.rejects(confirm(EMPTY, plan, { literal: 'EXCLUIR ' }), { code: '22023' });
    assert.equal(await exists(EMPTY), true);
    assert.equal(await confirm(EMPTY, plan), 'deleted');
    assert.equal(await exists(EMPTY), false);
    assert.deepEqual((await db.query('select id from auth.sessions where user_id=$1', [EMPTY])).rows, []);
    assert.deepEqual((await db.query('select id from public.caa_profiles where id=$1', [EMPTY])).rows, []);
  });

  await t.test('revalida o sucessor e transfere os registros, o áudio, a configuração e a foto do paciente compartilhado', async () => {
    const plan = await preview(OWNER);
    assert.equal(plan.review_reason, null);
    assert.deepEqual(plan.patients, [{
      patient_id: SHARED_CHILD, patient_name: 'Criança compartilhada',
      successor_id: SUCCESSOR, successor_name: 'Corresponsável autorizado',
    }]);
    await db.query('update public.caa_guardian_members set can_manage_links=false where crianca_id=$1', [SHARED_CHILD]);
    assert.equal(await confirm(OWNER, plan), 'plan_changed');
    assert.equal(await exists(OWNER), true);
    await db.query('update public.caa_guardian_members set can_manage_links=true where crianca_id=$1', [SHARED_CHILD]);

    assert.equal(await confirm(OWNER, plan), 'deleted');
    assert.equal(await exists(OWNER), false);
    assert.deepEqual(await asUser(SUCCESSOR, async () => ({
      owner: (await db.query('select usuario_id from public.criancas where id=$1', [SHARED_CHILD])).rows[0].usuario_id,
      events: (await db.query('select rotulo,usuario_id from public.caa_events where crianca_id=$1', [SHARED_CHILD])).rows,
      settings: (await db.query('select settings from public.caa_board_settings where crianca_id=$1', [SHARED_CHILD])).rows[0].settings,
      symbol: (await db.query('select image_path,created_by from public.caa_custom_symbols where crianca_id=$1', [SHARED_CHILD])).rows[0],
      audio: (await db.query('select * from public.get_caa_pronunciation_audio($1)', [RECORDING])).rows[0],
      notes: (await db.query('select observation from public.list_caa_pronunciation_notes($1)', [RECORDING])).rows,
    })), {
      owner: SUCCESSOR, events: [{ rotulo: 'Água', usuario_id: SUCCESSOR }],
      settings: { pageSize: 16, categoryImages: { animais: 2517 } },
      symbol: { image_path: PHOTO, created_by: null },
      audio: { mime_type: 'audio/webm', audio_base64: Buffer.from(AUDIO, 'hex').toString('base64') },
      notes: [{ observation: 'Observação profissional' }],
    });
    assert.deepEqual((await db.query('select guardian_id,uploaded_by,state from comunica_board_private.symbol_images where path=$1', [PHOTO])).rows,
      [{ guardian_id: SUCCESSOR, uploaded_by: null, state: 'attached' }]);
    assert.deepEqual((await db.query('select name from storage.objects where bucket_id=$1', [BUCKET])).rows, [{ name: PHOTO }]);
    assert.deepEqual((await db.query('select professional_id from public.caa_members where crianca_id=$1', [SHARED_CHILD])).rows,
      [{ professional_id: PROFESSIONAL }]);
    await assert.rejects(asUser(OWNER, () => db.query('select * from public.get_caa_pronunciation_audio($1)', [RECORDING])),
      { code: '42501' });
  });

  await t.test('solicita análise para responsável único e mantém a conta e o paciente', async () => {
    const plan = await preview(SOLE_GUARDIAN);
    assert.equal(plan.review_reason, 'patient_care');
    assert.deepEqual(plan.patients, [{
      patient_id: SOLE_CHILD, patient_name: 'Criança sem sucessor', successor_id: null, successor_name: null,
    }]);
    assert.equal(await confirm(SOLE_GUARDIAN, plan), 'review_requested');
    const requested = await preview(SOLE_GUARDIAN);
    assert.ok(requested.review_requested_at instanceof Date);
    assert.equal(await confirm(SOLE_GUARDIAN, requested), 'review_requested');
    assert.deepEqual((await preview(SOLE_GUARDIAN)).review_requested_at, requested.review_requested_at);
    assert.equal(await exists(SOLE_GUARDIAN), true);
    assert.deepEqual(await asUser(SOLE_GUARDIAN, async () =>
      (await db.query('select id from public.criancas')).rows), [{ id: SOLE_CHILD }]);
  });

  await t.test('solicita análise para ambas as colunas de dono no Storage e mantém os arquivos', async () => {
    const beforeFiles = await preview(STORAGE_OWNER);
    assert.equal(beforeFiles.review_reason, null);
    await db.query('insert into storage.objects (bucket_id,name,owner_id) values ($1,$2,$3)',
      [BUCKET, 'current-owner-id.webp', STORAGE_OWNER]);
    assert.equal(await confirm(STORAGE_OWNER, beforeFiles), 'plan_changed');
    const currentOwner = await preview(STORAGE_OWNER);
    assert.equal(currentOwner.review_reason, 'storage');
    assert.equal(await confirm(STORAGE_OWNER, currentOwner), 'review_requested');
    assert.equal(await exists(STORAGE_OWNER), true);
    assert.deepEqual((await db.query('select name from storage.objects where owner_id=$1', [STORAGE_OWNER])).rows,
      [{ name: 'current-owner-id.webp' }]);

    await db.query('delete from storage.objects where owner_id=$1', [STORAGE_OWNER]);
    await db.query('insert into storage.objects (bucket_id,name,owner) values ($1,$2,$3)',
      [BUCKET, 'legacy-owner.webp', STORAGE_OWNER]);
    const legacyOwner = await preview(STORAGE_OWNER);
    assert.equal(legacyOwner.review_reason, 'storage');
    assert.equal(await confirm(STORAGE_OWNER, legacyOwner), 'review_requested');
    assert.equal(await exists(STORAGE_OWNER), true);
    assert.deepEqual((await db.query('select name from storage.objects where owner=$1', [STORAGE_OWNER])).rows,
      [{ name: 'legacy-owner.webp' }]);
  });
});

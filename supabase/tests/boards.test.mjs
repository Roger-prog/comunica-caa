import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';
const PROFESSIONAL = '33333333-3333-4333-8333-333333333333';
const UNCONFIRMED = '44444444-4444-4444-8444-444444444444';
const CHILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUCKET = 'caa-symbol-images';

const migrations = await Promise.all([
  '001_initial_schema.sql', '002_professional_links.sql', '003_account_roles.sql',
  '005_invitation_ten_minutes.sql', '006_personalized_boards.sql',
  '007_seed_board_catalog.sql',
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));

async function fixture(db) {
  // Mirrors the managed Auth/Storage columns and operation names used by 006.
  // It exercises real Postgres RLS. Production Storage uploads remain an HTTP
  // integration check because the mock has no underlying file service.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{"provider":"email"}',
      email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;

    create schema storage;
    create table storage.buckets (
      id text primary key, name text unique not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      bucket_id text references storage.buckets, name text, metadata jsonb,
      primary key(bucket_id, name)
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
  for (const sql of migrations.slice(0, -2)) await db.exec(sql);
  for (const [id, role, confirmed] of [
    [OWNER, 'responsavel', true], [OTHER_OWNER, 'responsavel', true],
    [PROFESSIONAL, 'fonoaudiologo', true], [UNCONFIRMED, 'fonoaudiologo', false],
  ]) {
    await db.query(`
      insert into auth.users(id,raw_user_meta_data,email_confirmed_at)
      values ($1,$2,case when $3::boolean then now() else null end)
    `, [id, { role, nome: 'Teste', consent: true }, confirmed]);
  }
  await db.query('insert into public.criancas(id,usuario_id,nome) values($1,$2,$3),($4,$5,$6)',
    [CHILD, OWNER, 'Paciente A', OTHER_CHILD, OTHER_OWNER, 'Paciente B']);
  await db.query('insert into public.caa_members(crianca_id,professional_id) values($1,$2),($1,$3)',
    [CHILD, PROFESSIONAL, UNCONFIRMED]);
  for (const sql of migrations.slice(-2)) await db.exec(sql);
}

test('PostgreSQL: board, authorized photos and immediate link revocation', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await fixture(db);

  const as = async (id, callback, operation = '') => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)",
      [id ?? '', operation]);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try {
      return await callback();
    } finally {
      await db.exec('reset role');
    }
  };
  const denied = (promise, code = '42501') =>
    assert.rejects(promise, { code });
  const size = (table) => db.query(`select count(*)::int as count from ${table}`)
    .then(({ rows }) => rows[0].count);
  const reserve = (id, patient = CHILD, allowed = true) => as(id, async () =>
    (await db.query('select public.reserve_caa_symbol_image($1,$2) as path', [patient, allowed])).rows[0].path);
  const upload = (id, path, metadata = { size: 1224, mimetype: 'image/webp' }) => as(id, () =>
    db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', [BUCKET, path, metadata]),
    'object.upload');
  const remove = (id, path) => as(id, () =>
    db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name', [BUCKET, path]),
    'object.delete_many');
  const cleanup = (id, patient = CHILD) => as(id, async () =>
    (await db.query('select public.list_caa_symbol_image_cleanup($1) as paths', [patient])).rows[0].paths);
  const saveSymbol = (id, {
    patient = CHILD, symbolId = null, label = 'Símbolo', speech = 'Frase falada.',
    categories = ['essencial'], arasaacId = 12, path = null, hidden = false, version = 0,
  } = {}) => as(id, async () => (await db.query(
    'select * from public.save_caa_custom_symbol($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [patient, symbolId, label, speech, categories, arasaacId, path, hidden, version],
  )).rows[0]);
  const deleteSymbol = (id, patient, symbolId, version) => as(id, async () =>
    (await db.query('select * from public.delete_caa_custom_symbol($1,$2,$3)', [patient, symbolId, version])).rows[0]);
  const saveSettings = (id, version, settings = { pageSize: 12 }, patient = CHILD) =>
    as(id, () => db.query('select * from public.save_caa_board_settings($1,$2,$3)', [patient, settings, version]));
  const boardAccess = (id, patient = CHILD) => as(id, async () =>
    (await db.query('select public.has_caa_board_access($1) as allowed', [patient])).rows[0].allowed);
  const setAccess = (id, allowed, professional = PROFESSIONAL, patient = CHILD) => as(id, async () =>
    (await db.query('select public.set_caa_board_member_access($1,$2,$3) as allowed',
      [patient, professional, allowed])).rows[0].allowed);

  await t.test('patient data and RPCs deny anon and unconfirmed accounts', async () => {
    for (const table of ['public.caa_catalog_symbols', 'public.caa_custom_symbols',
      'public.caa_board_settings', 'public.caa_catalog_overrides']) {
      await denied(as(null, () => size(table)));
      assert.equal(await as(UNCONFIRMED, () => size(table)), 0);
    }
    await denied(saveSettings(null, 0));
    await denied(saveSettings(UNCONFIRMED, 0));
    await denied(reserve(UNCONFIRMED));
    await denied(as(OWNER, () => size('comunica_board_private.symbol_images')));
  });

  await t.test('existing links still read history and require owner opt-in to access the board', async () => {
    assert.equal(await as(PROFESSIONAL, () => size('public.criancas')), 1);
    assert.equal(await boardAccess(PROFESSIONAL), false);
    assert.equal(await boardAccess(OWNER), true);
    assert.equal(await boardAccess(OTHER_OWNER), false);
    await denied(saveSettings(PROFESSIONAL, 0));
    await denied(setAccess(PROFESSIONAL, true));
    await denied(setAccess(OTHER_OWNER, true));
    await denied(setAccess(null, true));
    await denied(as(PROFESSIONAL, () => db.query('update public.caa_members set board_access=true')));
    assert.equal(await setAccess(OWNER, true), true);
    assert.equal(await boardAccess(PROFESSIONAL), true);
    assert.equal(await boardAccess(PROFESSIONAL, OTHER_CHILD), false);
    assert.equal(await setAccess(OWNER, true, UNCONFIRMED), true);
    assert.equal(await boardAccess(UNCONFIRMED), false);
    await denied(as(OWNER, () => size('comunica_board_private.access_changes')));
  });

  await t.test('settings are patient-scoped and reject concurrent overwrites', async () => {
    assert.equal((await saveSettings(OWNER, 0)).rows[0].version, 1);
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_board_settings')), 1);
    assert.equal(await as(OTHER_OWNER, () => size('public.caa_board_settings')), 0);
    await denied(saveSettings(OTHER_OWNER, 1));
    await denied(saveSettings(PROFESSIONAL, 0), '40001');
    assert.deepEqual((await saveSettings(PROFESSIONAL, 1, { pageSize: 8 })).rows[0].settings, { pageSize: 8 });
    await denied(as(OWNER, () => db.query('update public.caa_board_settings set version=999')));
  });

  await t.test('catalog review is private by patient and leaves the original word unchanged', async () => {
    await as(PROFESSIONAL, () => db.query("select public.save_caa_catalog_override($1,'agua',404)", [CHILD]));
    const total = await as(OWNER, () => size('public.caa_catalog_symbols'));
    assert.ok(total > 400);
    await db.exec(migrations.at(-1));
    assert.equal(await as(OWNER, () => size('public.caa_catalog_symbols')), total);
    assert.equal(await as(OWNER, () => size('public.caa_catalog_overrides')), 1);
    assert.equal(await as(OTHER_OWNER, () => size('public.caa_catalog_overrides')), 0);
    await denied(as(PROFESSIONAL, () => db.query("select public.save_caa_catalog_override($1,'agua',55)", [OTHER_CHILD])));
    await denied(as(OWNER, () => db.query("update public.caa_catalog_symbols set label='Modificado'")));
    await as(OWNER, () => db.query("select public.save_caa_catalog_override($1,'agua',null)", [CHILD]));
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_catalog_overrides')), 0);
  });

  await t.test('reload preserves ordered Home and quick phrases only on the selected patient', async () => {
    const settings = {
      pageSize: 12, homeSymbols: ['agua', 'sim', 'nao'], favorites: ['dor'],
      quickPhrasesEnabled: true, speakOnSelect: false, maxSentenceSymbols: 50,
      quickPhrases: [{ id: 'teste', label: 'Pedir ajuda', text: 'Preciso de ajuda.' }],
    };
    assert.equal((await saveSettings(PROFESSIONAL, 2, settings)).rows[0].version, 3);
    const load = (id) => as(id, () => db.query(
      'select settings from public.caa_board_settings where crianca_id=$1', [CHILD],
    ));
    assert.deepEqual((await load(OWNER)).rows[0].settings, settings);
    assert.deepEqual((await load(OTHER_OWNER)).rows, []);
  });

  await t.test('linked professional can edit shared symbols but only delete their own', async () => {
    const { symbol } = await saveSymbol(OWNER);
    assert.equal(symbol.source, 'arasaac');
    assert.equal(symbol.created_by, OWNER);
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_custom_symbols')), 1);
    assert.equal(await as(OTHER_OWNER, () => size('public.caa_custom_symbols')), 0);
    await denied(saveSymbol(OTHER_OWNER, { symbolId: symbol.id, version: 1 }));
    await denied(saveSymbol(OTHER_OWNER, { patient: OTHER_CHILD, symbolId: symbol.id, version: 1 }));
    await denied(saveSymbol(PROFESSIONAL, { categories: ['essencial', 'essencial'] }), '22023');
    await denied(saveSymbol(PROFESSIONAL, { categories: ['saúde'] }), '22023');
    await denied(deleteSymbol(PROFESSIONAL, CHILD, symbol.id, 1));
    const edited = await saveSymbol(PROFESSIONAL, {
      symbolId: symbol.id, version: 1, hidden: true, categories: ['essencial','necessidades'],
    });
    assert.equal(edited.symbol.hidden, true);
    assert.equal(edited.symbol.created_by, OWNER);
    await denied(saveSymbol(OWNER, { symbolId: symbol.id, version: 1 }), '40001');
    const restored = await saveSymbol(OWNER, { symbolId: symbol.id, version: 2 });
    assert.equal(restored.symbol.hidden, false);
    const second = await saveSymbol(PROFESSIONAL);
    await deleteSymbol(PROFESSIONAL, CHILD, second.symbol.id, 1);
    await deleteSymbol(OWNER, CHILD, symbol.id, 3);
    assert.equal(await as(OWNER, () => size('public.caa_custom_symbols')), 0);
  });

  await t.test('photo creation requires authorization, correct patient, upload and supported metadata', async () => {
    await denied(reserve(OWNER, CHILD, false), '22023');
    await denied(reserve(PROFESSIONAL, OTHER_CHILD));
    const path = await reserve(OWNER);
    assert.match(path, new RegExp(`^${CHILD}/[0-9a-f-]{36}$`));
    const { rows: [bucket] } = await db.query(
      'select public,file_size_limit::int,allowed_mime_types from storage.buckets where id=$1', [BUCKET]);
    assert.deepEqual(bucket, { public: false, file_size_limit: 2097152,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
    await denied(upload(OTHER_OWNER, path));
    await denied(upload(PROFESSIONAL, path));
    await denied(as(OWNER, () => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
      [BUCKET, path, { size: 1224, mimetype: 'image/webp' }]), 'object.sign_upload_url'));
    await denied(saveSymbol(OWNER, { path, arasaacId: null }), '22023');
    const invalid = await reserve(OWNER);
    await upload(OWNER, invalid, { size: 1, mimetype: 'image/svg+xml' });
    await denied(saveSymbol(OWNER, { path: invalid, arasaacId: null }), '22023');
    await upload(OWNER, path);
    await denied(saveSymbol(PROFESSIONAL, { path, arasaacId: null }), '22023');
    await denied(saveSymbol(OTHER_OWNER, { patient: OTHER_CHILD, path, arasaacId: null }), '22023');
    const created = (await saveSymbol(OWNER, { path, arasaacId: null })).symbol;
    assert.equal(created.source, 'personalizado');
    assert.equal(created.image_path, path);
    await denied(saveSymbol(OWNER, { path, arasaacId: null }), '22023');
  });

  await t.test('active photos cannot be read from Storage, signed, listed, overwritten or deleted', async () => {
    const { rows: [symbol] } = await db.query('select * from public.caa_custom_symbols where image_path is not null');
    for (const operation of ['object.get_authenticated', 'object.get', 'object.sign', 'object.sign_many',
      'object.list', 'object.delete_many', '']) {
      for (const id of [OWNER, PROFESSIONAL, OTHER_OWNER, null]) {
        assert.equal(await as(id, () => size('storage.objects'), operation), 0, operation);
      }
    }
    assert.equal((await remove(OWNER, symbol.image_path)).rows.length, 0);
    assert.equal(await as(OWNER, async () => (await db.query('update storage.objects set name=$1 returning name',
      ['blocked'])).rows.length, 'object.upload_update'), 0);
    assert.equal(await as(OWNER, async () => (await db.query('update storage.buckets set public=true returning id')).rows.length), 0);
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_custom_symbols')), 1);
  });

  await t.test('photo replacement retires the old path, supports retries and isolates cleanup', async () => {
    const { rows: [symbol] } = await db.query('select * from public.caa_custom_symbols where image_path is not null');
    const replacement = await reserve(PROFESSIONAL);
    await upload(PROFESSIONAL, replacement);
    const edit = await saveSymbol(PROFESSIONAL, {
      symbolId: symbol.id, version: 1, path: replacement, arasaacId: null,
    });
    assert.equal(edit.retired_path, symbol.image_path);
    assert.ok((await cleanup(PROFESSIONAL)).includes(symbol.image_path));
    assert.deepEqual(await cleanup(OTHER_OWNER), []);
    assert.equal((await remove(OTHER_OWNER, symbol.image_path)).rows.length, 0);
    assert.equal((await remove(PROFESSIONAL, symbol.image_path)).rows[0].name, symbol.image_path);
    assert.equal((await cleanup(PROFESSIONAL)).length, 0);

    const staging = await reserve(PROFESSIONAL);
    await upload(PROFESSIONAL, staging);
    assert.equal((await remove(PROFESSIONAL, staging)).rows.length, 0);
    await as(PROFESSIONAL, () => db.query('select public.discard_caa_symbol_image($1,$2)', [CHILD, staging]));
    await denied(saveSymbol(PROFESSIONAL, { path: staging, arasaacId: null }), '22023');
    assert.equal((await remove(PROFESSIONAL, staging)).rows[0].name, staging);
  });

  await t.test('link revocation immediately removes access and pending upload eligibility', async () => {
    const pendingPath = await reserve(PROFESSIONAL);
    assert.equal(await setAccess(OWNER, false), false);
    assert.equal(await boardAccess(PROFESSIONAL), false);
    assert.equal(await as(PROFESSIONAL, () => size('public.criancas')), 1);
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_custom_symbols')), 0);
    await denied(upload(PROFESSIONAL, pendingPath));
    assert.equal(await setAccess(OWNER, true), true);
    await denied(upload(PROFESSIONAL, pendingPath));
    assert.equal((await as(OWNER, () => db.query('select public.revoke_caa_member($1,$2) as revoked',
      [CHILD, PROFESSIONAL]))).rows[0].revoked, true);
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_custom_symbols')), 0);
    assert.equal(await as(PROFESSIONAL, () => size('public.caa_board_settings')), 0);
    await denied(reserve(PROFESSIONAL));
    await denied(upload(PROFESSIONAL, pendingPath));
    await denied(saveSymbol(PROFESSIONAL));
    await denied(saveSettings(PROFESSIONAL, 2));
    assert.deepEqual(await cleanup(PROFESSIONAL), []);
    assert.equal(await as(OWNER, () => size('public.caa_custom_symbols')), 1);
    assert.deepEqual((await db.query(
      'select action from comunica_board_private.access_changes where professional_id=$1 order by id',
      [PROFESSIONAL])).rows.map(({ action }) => action),
    ['link_created', 'board_enabled', 'board_disabled', 'board_enabled', 'link_removed']);
  });

  await t.test('patient deletion retires attached photos and leaves retry cleanup to the guardian', async () => {
    const { rows: [symbol] } = await db.query('select * from public.caa_custom_symbols where image_path is not null');
    await as(OWNER, () => db.query('delete from public.criancas where id=$1', [CHILD]));
    assert.equal(await as(OWNER, () => size('public.caa_custom_symbols')), 0);
    assert.equal(await as(OWNER, () => size('public.caa_board_settings')), 0);
    assert.ok((await cleanup(OWNER)).includes(symbol.image_path));
    assert.deepEqual(await cleanup(PROFESSIONAL), []);
    assert.equal((await remove(OWNER, symbol.image_path)).rows[0].name, symbol.image_path);
  });
});

test('PostgreSQL: event upgrade, scoped history and retention', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await fixture(db);
  await db.query(`
    insert into public.comunicacoes (usuario_id,crianca_id,pictograma_id,rotulo,categoria,created_at)
    values ($1,$2,'agua','Água','Necessidades','2026-01-01 12:00:00Z')
  `, [OWNER, CHILD]);

  await db.exec(await readFile(new URL('../migrations/008_communication_events.sql', import.meta.url), 'utf8'));

  const as = async (id, callback, operation = '') => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)",
      [id ?? '', operation]);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try {
      return await callback();
    } finally {
      await db.exec('reset role');
    }
  };
  const selectEvents = (id) => as(id, () => db.query(`
    select id,event_type,symbol_source,arasaac_id,pictograma_id,rotulo,categoria
    from public.caa_events where crianca_id = $1 order by created_at
  `, [CHILD])).then(({ rows }) => rows);
  const record = (accountId, {
    ownerId = OWNER, childId = CHILD, type = 'symbol_selection',
    source = 'catalog', symbolId = 'agua', text = 'Água',
    category = 'Necessidades', imageId = 32408,
  } = {}) => as(accountId, () => db.query(`
    insert into public.comunicacoes
      (usuario_id,crianca_id,event_type,symbol_source,pictograma_id,rotulo,categoria,arasaac_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning id
  `, [ownerId, childId, type, source, symbolId, text, category, imageId]));
  const saveSymbol = (id, patient, label, arasaacId) => as(id, () => db.query(`
    select symbol from public.save_caa_custom_symbol($1,null,$2,'Minha fala',
      array['essencial'],$3,null,false,0)
  `, [patient, label, arasaacId])).then(({ rows }) => rows[0].symbol);
  const message = (text) => ({
    type: 'message_playback', source: null, symbolId: null,
    text, category: null, imageId: null,
  });

  await t.test('pre-upgrade records keep labels without inferring a selection or a playback', async () => {
    const [event] = await selectEvents(OWNER);
    assert.deepEqual(event, {
      id: event.id, event_type: 'legacy_symbol', symbol_source: null, arasaac_id: null,
      pictograma_id: 'agua', rotulo: 'Água', categoria: 'Necessidades',
    });
    assert.deepEqual(await selectEvents(PROFESSIONAL), [event]);
    assert.deepEqual(await selectEvents(OTHER_OWNER), []);
  });


  await t.test('the earlier client can still write and query the original row projection', async () => {
    const { rows: [row] } = await as(OWNER, () => db.query(`
      insert into public.comunicacoes (crianca_id,pictograma_id,rotulo,categoria)
      values ($1,'ajuda','Ajuda','Necessidades') returning id, event_type
    `, [CHILD]));
    assert.equal(row.event_type, 'legacy_symbol');
    const { rows } = await as(PROFESSIONAL, () => db.query(`
      select id,usuario_id,crianca_id,pictograma_id,rotulo,categoria,created_at
      from public.caa_events where id = $1
    `, [row.id]));
    assert.equal(rows[0].rotulo, 'Ajuda');
    await as(OWNER, () => db.query('delete from public.comunicacoes where id=$1', [row.id]));
  });

  await t.test('stores custom identity and message text separately without copying photographs', async () => {
    const item = await saveSymbol(OWNER, CHILD, 'Símbolo criado', 12);
    await record(OWNER);
    const selection = await record(OWNER, {
      source: 'custom', symbolId: item.id, text: item.label, imageId: item.arasaac_id,
    });
    const phrase = 'Quero repetir esta mensagem. '.repeat(400).trim();
    const playback = await record(OWNER, message(phrase));
    const events = await selectEvents(OWNER);
    assert.equal(events.length, 4);
    assert.equal(events.filter(({ event_type }) => event_type === 'symbol_selection').length, 2);
    assert.deepEqual(events.find(({ pictograma_id }) => pictograma_id === item.id), {
      id: selection.rows[0].id,
      event_type: 'symbol_selection', symbol_source: 'custom', arasaac_id: 12,
      pictograma_id: item.id, rotulo: item.label, categoria: 'Necessidades',
    });
    assert.deepEqual(events.find(({ id }) => id === playback.rows[0].id), {
      id: playback.rows[0].id, event_type: 'message_playback', symbol_source: null,
      arasaac_id: null, pictograma_id: null, rotulo: phrase, categoria: null,
    });
    await as(OWNER, () => db.query('select * from public.delete_caa_custom_symbol($1,$2,$3)', [CHILD, item.id, item.version]));
    assert.ok((await selectEvents(OWNER)).some(({ pictograma_id, rotulo }) => pictograma_id === item.id && rotulo === item.label));
  });

  await t.test('validates event shape and isolates custom IDs and timestamps', async () => {
    const other = await saveSymbol(OTHER_OWNER, OTHER_CHILD, 'Outro paciente', 13);
    await assert.rejects(record(OWNER, { source: 'custom', symbolId: other.id }), { code: '42501' });
    await assert.rejects(record(OWNER, { ...message('Teste'), symbolId: 'agua' }), { code: '23514' });
    await assert.rejects(record(OWNER, { source: null }), { code: '23514' });
    await assert.rejects(record(OWNER, { imageId: 0 }), { code: '23514' });
    await assert.rejects(record(OWNER, message('x'.repeat(16001))), { code: '23514' });
    await assert.rejects(record(OWNER, { ownerId: OTHER_OWNER, childId: OTHER_CHILD }), { code: '42501' });
    await assert.rejects(record(PROFESSIONAL, message('Teste')), { code: '42501' });
    await assert.rejects(record(null), { code: '42501' });
    await assert.rejects(as(OWNER, () => db.query(`
      insert into public.comunicacoes (crianca_id,pictograma_id,rotulo,categoria,created_at)
      values ($1,'agua','Água','Necessidades','2025-01-01 00:00:00Z')
    `, [CHILD])), { code: '42501' });
  });



  await t.test('history of a private photograph stores its symbol but never exposes its file', async () => {
    const { rows: [{ path }] } = await as(OWNER, () => db.query(
      'select public.reserve_caa_symbol_image($1,true) as path', [CHILD]));
    await as(OWNER, () => db.query(
      'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
      [BUCKET, path, { size: 1224, mimetype: 'image/png' }]), 'object.upload');
    const { rows: [{ symbol }] } = await as(OWNER, () => db.query(`
      select symbol from public.save_caa_custom_symbol($1,null,'Fotografia fictícia',
        'Texto fictício',array['essencial'],null,$2,false,0)
    `, [CHILD, path]));
    const { rows: [{ id }] } = await record(OWNER, {
      source: 'custom', symbolId: symbol.id, text: symbol.label, imageId: null,
    });
    const history = (viewer) => as(viewer, () => db.query(
      'select * from public.caa_events where id=$1', [id])).then(({ rows }) => rows);
    assert.equal((await history(OWNER))[0].pictograma_id, symbol.id);
    const linked = await history(PROFESSIONAL);
    assert.equal(linked[0].rotulo, symbol.label);
    assert.equal(linked[0].arasaac_id, null);
    assert.ok(!JSON.stringify(linked).includes(path));
    assert.deepEqual(await history(OTHER_OWNER), []);
    const boardSymbol = (viewer) => as(viewer, () => db.query(
      'select image_path from public.caa_custom_symbols where id=$1', [symbol.id])).then(({ rows }) => rows);
    assert.deepEqual(await boardSymbol(OWNER), [{ image_path: path }]);
    assert.deepEqual(await boardSymbol(PROFESSIONAL), []);
    assert.deepEqual(await boardSymbol(OTHER_OWNER), []);
    await as(OWNER, () => db.query('select * from public.delete_caa_custom_symbol($1,$2,$3)', [CHILD, symbol.id, symbol.version]));
    assert.equal((await history(OWNER))[0].rotulo, symbol.label);
    await as(OWNER, () => db.query('delete from public.comunicacoes where id=$1', [id]));
  });

  await t.test('the recording preference blocks writes and survives other board edits', async () => {
    const settings = (id, version, fields) => as(id, () => db.query(
      'select settings, version from public.save_caa_board_settings($1,$2,$3)',
      [CHILD, fields, version],
    )).then(({ rows }) => rows[0]);
    await as(OWNER, () => db.query('select public.set_caa_board_member_access($1,$2,true)', [CHILD, PROFESSIONAL]));
    assert.deepEqual(await settings(PROFESSIONAL, 0, { pageSize: 12, historyRecording: false }), {
      version: 1, settings: { pageSize: 12 },
    });
    assert.deepEqual(await settings(OWNER, 1, { pageSize: 12, historyRecording: false }), {
      version: 2, settings: { pageSize: 12, historyRecording: false },
    });
    await assert.rejects(record(OWNER), { code: '42501' });
    await assert.rejects(record(OWNER, message('Com gravação desligada')), { code: '42501' });
    assert.deepEqual(await settings(PROFESSIONAL, 2, { pageSize: 8, historyRecording: true }), {
      version: 3, settings: { pageSize: 8, historyRecording: false },
    });
    assert.deepEqual(await settings(OWNER, 3, { pageSize: 10 }), {
      version: 4, settings: { pageSize: 10, historyRecording: false },
    });
    await assert.rejects(settings(OWNER, 4, { historyRecording: 'true' }), { code: '22023' });
    await assert.rejects(record(OWNER), { code: '42501' });
    await record(OTHER_OWNER, { ownerId: OTHER_OWNER, childId: OTHER_CHILD });
    assert.equal((await settings(OWNER, 4, { pageSize: 10, historyRecording: true })).settings.historyRecording, true);
    await record(OWNER);
    assert.equal((await selectEvents(OWNER)).length, 5);
  });

  await t.test('linked professionals can read, but only the guardian can purge the selected period', async () => {
    const removeOlderThan = (id, date) => as(id, () => db.query(`
      delete from public.comunicacoes where crianca_id = $1 and created_at < $2 returning id
    `, [CHILD, date]));
    await as(OWNER, () => db.query('select public.set_caa_board_member_access($1,$2,true)', [CHILD, PROFESSIONAL]));
    const createdByProfessional = await saveSymbol(PROFESSIONAL, CHILD, 'Criado pelo fono', 15);
    await record(OWNER, { source: 'custom', symbolId: createdByProfessional.id, text: createdByProfessional.label, imageId: 15 });
    assert.equal((await selectEvents(PROFESSIONAL)).length, 6);
    assert.equal((await removeOlderThan(PROFESSIONAL, '2026-02-01')).rows.length, 0);
    assert.equal((await removeOlderThan(OTHER_OWNER, '2026-02-01')).rows.length, 0);
    assert.equal((await removeOlderThan(OWNER, '2026-02-01')).rows.length, 1);
    assert.equal((await selectEvents(OWNER)).length, 5);
    await as(OWNER, () => db.query('select public.set_caa_board_member_access($1,$2,false)', [CHILD, PROFESSIONAL]));
    assert.equal((await selectEvents(PROFESSIONAL)).length, 5);
    await as(OWNER, () => db.query('select public.revoke_caa_member($1,$2)', [CHILD, PROFESSIONAL]));
    assert.deepEqual(await selectEvents(PROFESSIONAL), []);
    await db.query('delete from auth.users where id = $1', [OWNER]);
    assert.equal((await db.query('select id from public.comunicacoes where crianca_id = $1', [CHILD])).rows.length, 0);
  });
});

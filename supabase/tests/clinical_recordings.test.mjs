import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PROFESSIONAL = '33333333-3333-4333-8333-333333333333';
const CO_GUARDIAN = '44444444-4444-4444-8444-444444444444';
const PATIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PATIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OTHER_CLIP = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const fixtureClip = Buffer.from('1a45dfa30001020304050607', 'hex').toString('base64');

test('private pronunciation clips and server-side history filtering', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text,
      raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{"provider":"email"}',
      email_confirmed_at timestamptz
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
      bucket_id text references storage.buckets, name text, metadata jsonb,
      primary key (bucket_id, name)
    );
    create function storage.allow_any_operation(text[]) returns boolean language sql stable as $$
      select false
    $$;
    alter table storage.objects enable row level security;
    alter table storage.buckets enable row level security;
  `);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const entry of (await readdir(migrations)).sort().filter((name) => name <= '013_history_query.sql')) {
    await db.exec(await readFile(new URL(entry, migrations), 'utf8'));
  }

  for (const [id, role, email] of [
    [OWNER, 'responsavel', 'owner@example.test'],
    [OTHER, 'responsavel', 'other@example.test'],
    [CO_GUARDIAN, 'responsavel', 'guardian@example.test'],
    [PROFESSIONAL, 'fonoaudiologo', 'professional@example.test'],
  ]) {
    await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',
      [id, email, { role, nome: 'Conta fictícia', consent: true }]);
  }
  await db.query('insert into public.criancas(id,usuario_id,nome) values($1,$2,$3),($4,$5,$6)',
    [PATIENT, OWNER, 'Paciente A', OTHER_PATIENT, OTHER, 'Paciente B']);
  await db.query('insert into public.caa_members(crianca_id,professional_id) values($1,$2)', [PATIENT, PROFESSIONAL]);
  await db.query('insert into public.caa_guardian_members(crianca_id,guardian_id) values($1,$2)', [PATIENT, CO_GUARDIAN]);

  async function as(id, sql, args = []) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec('reset role');
    }
  }
  const save = (user, id, authorized = true, content = fixtureClip, patient = PATIENT) => as(user,
    'select public.save_caa_pronunciation($1,$2,$3,$4,$5,$6) as id', [patient, id, '  Água  ', 'audio/webm', content, authorized]);
  const settings = (user) => as(user, 'select * from public.get_caa_pronunciation_settings($1)', [PATIENT]);
  const list = (user) => as(user, 'select * from public.list_caa_pronunciation($1,null,null)', [PATIENT]);
  const read = (user, id = CLIP) => as(user, 'select * from public.get_caa_pronunciation_audio($1)', [id]);
  const allow = (user, listen, annotate) => as(user, 'select public.set_caa_pronunciation_access($1,$2,$3,$4)',
    [PATIENT, PROFESSIONAL, listen, annotate]);
  const note = (user, value) => as(user, 'select public.save_caa_pronunciation_note($1,$2)', [CLIP, value]);
  const remove = (user, id = CLIP) => as(user, 'select public.delete_caa_pronunciation($1)', [id]);
  const retention = (user, days) => as(user, 'select public.set_caa_pronunciation_retention($1,$2)', [PATIENT, days]);
  const denied = (promise) => assert.rejects(promise, { code: '42501' });

  await t.test('recording requires consent and authorization while storing only valid clipped audio', async () => {
    assert.deepEqual(await settings(OWNER), [{ can_read: true, can_record: true, can_manage: true, retention_days: 90 }]);
    await denied(save(OWNER, CLIP, false));
    await denied(save(CO_GUARDIAN, CLIP));
    await denied(save(OTHER, CLIP));
    await denied(save(PROFESSIONAL, CLIP));
    await denied(save(null, CLIP));
    await assert.rejects(save(OWNER, CLIP, true, 'QUFBQUFBQUFBQUFB'), { code: '22023' });
    assert.deepEqual(await save(OWNER, CLIP), [{ id: CLIP }]);
    assert.deepEqual(await save(OWNER, CLIP), [{ id: CLIP }]);
    const [row] = await list(OWNER);
    assert.equal(row.practice, 'Água');
    assert.equal(row.can_delete, true);
    assert.equal(Object.hasOwn(row, 'audio'), false);
    assert.deepEqual(await read(OWNER), [{ mime_type: 'audio/webm', audio_base64: fixtureClip }]);
    assert.deepEqual(await read(CO_GUARDIAN), await read(OWNER));
    await denied(read(OTHER));
    await denied(as(OWNER, 'select audio from comunica_pronunciation_private.recordings'));
  });

  await t.test('professional linking, playback, observations, and immediate revocation are independent permissions', async () => {
    await denied(allow(OWNER, true, false));
    await db.query('update public.caa_members set approved_at = now() where crianca_id=$1 and professional_id=$2',
      [PATIENT, PROFESSIONAL]);
    await denied(read(PROFESSIONAL));
    await denied(allow(CO_GUARDIAN, true, false));
    await allow(OWNER, true, false);
    assert.deepEqual(await read(PROFESSIONAL), await read(OWNER));
    await denied(note(PROFESSIONAL, 'Acompanhamento'));
    await allow(OWNER, true, true);
    await note(PROFESSIONAL, 'Primeira observação');
    await note(PROFESSIONAL, 'Observação atualizada');
    const rows = await as(OWNER, 'select * from public.list_caa_pronunciation_notes($1)', [CLIP]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].observation, 'Observação atualizada');
    await denied(remove(PROFESSIONAL));
    await db.query('delete from public.caa_members where crianca_id=$1 and professional_id=$2', [PATIENT, PROFESSIONAL]);
    await denied(read(PROFESSIONAL));
    await denied(note(PROFESSIONAL, 'Sem vínculo'));
    assert.equal((await as(OWNER, 'select * from public.list_caa_pronunciation_notes($1)', [CLIP])).length, 1);
  });

  await t.test('co-guardian revocation, manual removal, and retention remove access and expire stored content', async () => {
    await db.query('update public.caa_guardian_members set can_edit = true where crianca_id=$1 and guardian_id=$2',
      [PATIENT, CO_GUARDIAN]);
    await save(CO_GUARDIAN, OTHER_CLIP);
    await denied(remove(CO_GUARDIAN, CLIP));
    await denied(retention(CO_GUARDIAN, 30));
    await remove(CO_GUARDIAN, OTHER_CLIP);
    await denied(read(OWNER, OTHER_CLIP));
    await db.query('delete from public.caa_guardian_members where crianca_id=$1 and guardian_id=$2', [PATIENT, CO_GUARDIAN]);
    await denied(read(CO_GUARDIAN));
    await db.query(`update comunica_pronunciation_private.recordings
      set created_at = now() - interval '40 days', expires_at = now() + interval '50 days' where id=$1`, [CLIP]);
    await retention(OWNER, 30);
    assert.deepEqual(await list(OWNER), []);
    assert.equal((await db.query('select * from comunica_pronunciation_private.notes')).rows.length, 0);
    await save(OWNER, OTHER_CLIP);
    await db.query(`update comunica_pronunciation_private.recordings
      set created_at = now() - interval '31 days', expires_at = now() - interval '1 day' where id=$1`, [OTHER_CLIP]);
    await denied(read(OWNER, OTHER_CLIP));
    await db.exec('select comunica_pronunciation_private.purge_expired()');
    assert.equal((await db.query('select * from comunica_pronunciation_private.recordings')).rows.length, 0);
  });

  await t.test('history filters using local midnight, normalized search, event type and stable cursor ordering', async () => {
    await db.query(`
      insert into public.comunicacoes (crianca_id, usuario_id, event_type, rotulo, created_at)
      select $1,$2,'message_playback','Eu quero Água', value::timestamptz
      from unnest(array['2024-10-15 02:59:59+00','2024-10-15 03:00:00+00','2024-10-16 03:00:00+00']) as entries(value);
    `, [PATIENT, OWNER]);
    await db.query(`
      insert into public.comunicacoes (crianca_id, usuario_id, event_type, rotulo, created_at)
      select $1,$2,'message_playback','Registros para paginar','2024-10-15 11:00:00+00'
      from generate_series(1, 110);
    `, [PATIENT, OWNER]);
    const history = (id, args) => as(id, 'select * from public.query_caa_history($1,$2,$3,$4,$5,$6,$7)', args);
    const range = [PATIENT, '2024-10-15', '2024-10-15'];
    const search = [...range, 'message_playback', 'quero agua', null, null];
    const found = await history(OWNER, search);
    assert.equal(found.length, 1);
    assert.equal(found[0].created_at.toISOString(), '2024-10-15T03:00:00.000Z');
    assert.deepEqual(await history(OTHER, search), []);
    await denied(history(null, search));
    assert.deepEqual(await history(OWNER, [...range, 'symbol_selection', 'quero agua', null, null]), []);
    const page = await history(OWNER, [...range, null, 'paginar', null, null]);
    assert.equal(page.length, 101);
    const last = page[99];
    const next = await history(OWNER, [...range, null, 'paginar', last.created_at, last.id]);
    assert.equal(next.length, 10);
    assert.equal(next[0].id, page.at(-1).id);
  });
});

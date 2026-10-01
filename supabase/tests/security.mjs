import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Real PostgreSQL engine in WASM. Only Supabase's auth schema is a fixture.
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(await readFile(new URL('../migrations/001_comunica.sql',import.meta.url),'utf8'));
const owner='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002', pro='00000000-0000-0000-0000-000000000003';
for(const [id,role] of [[owner,'responsavel'],[other,'responsavel'],[pro,'fonoaudiologo']]) {
 await db.query('insert into auth.users values($1,$2,$3)',[id,`${id}@example.com`,{name:'Pessoa de teste',role,consent:true}]);
}
async function asUser(id,callback) {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 await db.exec(`set role ${id?'authenticated':'anon'}`);
 try {return await callback();} finally {await db.exec('reset role');}
}
async function rpc(user,action,child=null,target=null,data={}) {
 return asUser(user,async()=>(await db.query('select public.comunica_api($1,$2,$3,$4) as result',[action,child,target,data])).rows[0].result);
}
let passed=0;
async function test(name,fn) {await fn(); console.log(`PASS ${name}`); passed++;}
let child,word;
await test('anonymous cannot invoke API or read tables',async()=>{
 await assert.rejects(rpc(null,'children'),/permission denied/);
 await assert.rejects(asUser(null,()=>db.query('select * from public.caa_children')),/permission denied/);
});
await test('owner creates child with 16 words; professional cannot create child',async()=>{
 child=await rpc(owner,'add_child',null,null,{name:'Perfil SQL'});
 const words=await rpc(owner,'words',child.id); assert.equal(words.length,16); word=words[0];
 await assert.rejects(rpc(pro,'add_child',null,null,{name:'Inválido'}),/responsável/);
});
await test('table access and profile role changes are denied even when signed in',async()=>{
 await assert.rejects(asUser(owner,()=>db.query('select * from public.caa_children')),/permission denied/);
 await assert.rejects(asUser(owner,()=>db.query("update public.caa_profiles set role='fonoaudiologo'")),/permission denied/);
 const security=await db.query("select relname,relrowsecurity from pg_class where relname in ('caa_profiles','caa_children','caa_members','caa_words','caa_events')");
 assert.equal(security.rows.length,5); assert.ok(security.rows.every(r=>r.relrowsecurity));
});
await test('all per-child actions reject unrelated users',async()=>{
 assert.deepEqual(await rpc(other,'children'),[]);
 for(const action of ['words','report','history','members','add_event','add_word','edit_word','grant','revoke']) await assert.rejects(rpc(other,action,child.id),/acesso/);
});
await test('use is idempotent and does not imply mastery',async()=>{
 const event={word_id:word.id,kind:'use',stage:0,request_id:'sql-test-request-0001'};
 const first=await rpc(owner,'add_event',child.id,null,event);
 const second=await rpc(owner,'add_event',child.id,null,event);
 assert.equal(first.id,second.id);
 const report=await rpc(owner,'report',child.id); assert.equal(report.total_uses,1); assert.equal(report.mastered,0);
 await assert.rejects(rpc(owner,'add_event',child.id,null,{...event,stage:3}),/não confirma/);
 await assert.rejects(rpc(owner,'add_event',child.id,null,{...event,kind:'evolution',stage:2}),/Identificador/);
});
await test('grant allows professional observations; latest assessment determines mastery',async()=>{
 await rpc(owner,'grant',child.id,null,{email:`${pro}@example.com`});
 assert.equal((await rpc(pro,'children')).length,1);
 await rpc(pro,'add_event',child.id,null,{word_id:word.id,kind:'evolution',stage:3,note:'Observação de teste',request_id:'sql-evolution-0001'});
 assert.equal((await rpc(owner,'report',child.id)).mastered,1);
 await rpc(owner,'add_event',child.id,null,{word_id:word.id,kind:'use',stage:0,request_id:'sql-test-request-0002'});
 assert.equal((await rpc(owner,'report',child.id)).mastered,1);
 await rpc(pro,'add_event',child.id,null,{word_id:word.id,kind:'evolution',stage:1,request_id:'sql-evolution-0002'});
 assert.equal((await rpc(owner,'report',child.id)).mastered,0);
 await assert.rejects(rpc(pro,'grant',child.id,null,{email:`${other}@example.com`}),/responsável/);
});
await test('revocation immediately removes professional access',async()=>{
 await rpc(owner,'revoke',child.id,pro);
 await assert.rejects(rpc(pro,'report',child.id),/acesso/);
 assert.deepEqual(await rpc(pro,'children'),[]);
});
await test('cross-child words, invalid inputs and SQL injection are contained',async()=>{
 const second=await rpc(owner,'add_child',null,null,{name:'Outro'});
 await assert.rejects(rpc(owner,'add_event',second.id,null,{word_id:word.id,kind:'use',stage:0,request_id:'cross-child-request'}),/neste perfil/);
 await assert.rejects(rpc(owner,'add_child',null,null,{name:' '}),/Confira/);
 await assert.rejects(rpc(owner,'report',child.id,null,{days:0}),/Período/);
 await rpc(owner,'add_word',child.id,null,{label:"'; drop table caa_children; --",symbol:'💬',category:'Teste'});
 assert.equal((await rpc(owner,'children')).length,2);
});
await test('archive preserves past labels and prevents new uses',async()=>{
 await rpc(owner,'edit_word',child.id,String(word.id),{...word,label:'Água gelada',active:false});
 assert.equal((await rpc(owner,'history',child.id))[0].word_label,'Água');
 await assert.rejects(rpc(owner,'add_event',child.id,null,{word_id:word.id,kind:'use',stage:0,request_id:'archived-request-001'}),/Reative/);
});
await test('history pagination and UTC filters work',async()=>{
 await rpc(owner,'edit_word',child.id,String(word.id),{...word,active:true});
 for(let i=0;i<52;i++) await rpc(owner,'add_event',child.id,null,{word_id:word.id,kind:'use',stage:0,request_id:`page-test-request-${String(i).padStart(4,'0')}`});
 const first=await rpc(owner,'history',child.id),second=await rpc(owner,'history',child.id,null,{before:first.at(-1).id});
 assert.equal(first.length,50); assert.equal(second.length,6);
 await db.query("update public.caa_events set created_at='2020-01-01T00:00:00Z'");
 assert.equal((await rpc(owner,'report',child.id,null,{days:7})).total_uses,0);
});
await db.close();
console.log(`${passed} PostgreSQL checks passed.`);

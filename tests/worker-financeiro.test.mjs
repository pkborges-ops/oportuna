import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { recuperarConcessoesPendentes } from '../lib/analises/recuperacao-financeira.ts';

const id='10000000-0000-0000-0000-000000000001';
const token='20000000-0000-0000-0000-000000000001';
function banco(entrega='delivered', reserva=[{entrega_id:id,token}]) {
 const calls=[];
 return {calls, rpc:async(nome,args,signal)=>{
  calls.push({nome,args,signal});
  if(nome==='billing_concessoes_reservar_entregas_v1') {
   if(reserva instanceof Error) throw reserva;
   return {data:reserva,error:null};
  }
  if(entrega instanceof Error) throw entrega;
  return {data:entrega,error:null};
 }};
}
for(const [estado,campo] of [['delivered','entregues'],['duplicate','duplicadas'],['pending','pendentes'],
 ['stale','obsoletas'],['lease_lost','obsoletas'],['not_found','obsoletas'],['retry','falhas']]) {
 test('worker interpreta '+estado+' sem ACK ou repetição local',async()=>{
  const b=banco(estado); const r=await recuperarConcessoesPendentes({banco:b,ambiente:'sandbox'});
  assert.equal(r[campo],1); assert.equal(b.calls.length,2);
  assert.deepEqual(b.calls[0].args,{p_ambiente:'sandbox',p_limite:10});
  assert.deepEqual(b.calls[1].args,{p_ambiente:'sandbox',p_entrega:id,p_token:token});
  assert.ok(b.calls.every(c=>c.signal instanceof AbortSignal));
  assert.ok(!JSON.stringify(r).includes(token));
 });
}
test('worker lote vazio não entrega',async()=>{
 const b=banco('delivered',[]); assert.equal((await recuperarConcessoesPendentes({banco:b,ambiente:'sandbox'})).reservadas,0);
 assert.equal(b.calls.length,1);
});
test('falha de rede após gravação não repete nem devolve detalhes',async()=>{
 const b=banco(new Error('CHAVE_SECRETA resposta perdida'));
 const r=await recuperarConcessoesPendentes({banco:b,ambiente:'sandbox'});
 assert.equal(r.falhas,1); assert.equal(r.codigo,'PARCIAL'); assert.equal(b.calls.length,2);
 assert.ok(!JSON.stringify(r).includes('CHAVE_SECRETA'));
});
test('falha temporária na reserva não repete lote',async()=>{
 const b=banco('delivered',new Error('rede'));
 const r=await recuperarConcessoesPendentes({banco:b,ambiente:'sandbox'});
 assert.equal(r.codigo,'RESERVA_INDISPONIVEL'); assert.equal(b.calls.length,1);
});
test('ambiente inválido rejeitado antes da RPC; divergência no banco falha fechada',async()=>{
 const b=banco();
 await assert.rejects(()=>recuperarConcessoesPendentes({banco:b,ambiente:'inventado'}));
 assert.equal(b.calls.length,0);
 b.rpc=async()=>({data:null,error:{code:'42501',message:'interno'}});
 assert.equal((await recuperarConcessoesPendentes({banco:b,ambiente:'production'})).codigo,'RESERVA_INDISPONIVEL');
});
test('lote malformado, excessivo ou duplicado não dispara entrega',async()=>{
 for(const data of [{},[{entrega_id:id,token:'inválido'}],Array(11).fill({entrega_id:id,token}),Array(2).fill({entrega_id:id,token})]){
  const b=banco('delivered',data);
  assert.equal((await recuperarConcessoesPendentes({banco:b,ambiente:'sandbox'})).codigo,'RESERVA_INDISPONIVEL');
  assert.equal(b.calls.length,1);
 }
});
test('orçamento total deixa restante para recuperação pelo lease',async()=>{
 const b=banco(); let tempo=0;
 const rpc=b.rpc; b.rpc=async(...args)=>{const r=await rpc(...args);tempo=40_001;return r;};
 const r=await recuperarConcessoesPendentes({banco:b,ambiente:'sandbox',agora:()=>tempo});
 assert.equal(r.adiadas,1);assert.equal(r.codigo,'PARCIAL');assert.equal(b.calls.length,1);
});

// A rota real, com somente a fábrica do cliente administrativo substituída.
const state={calls:0,banco:banco()};
globalThis.__iaWorkerTeste=state;
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@/lib/supabase/admin') return {url:'data:text/javascript,export function criarClienteSupabaseAdmin(){const s=globalThis.__iaWorkerTeste;s.calls++;return {rpc:(...args)=>({abortSignal:signal=>s.banco.rpc(...args,signal)})};}',shortCircuit:true};
 return next(specifier,context);
}});
const {GET}=await import('../app/api/cron/concessoes-financeiras/route.ts');
hooks.deregister();
test('rota exige autenticação e configuração, usa cliente admin e sanitiza logs',async t=>{
 const keys=['CRON_SECRET','FINANCEIRO_WORKER_ENABLED','ASAAS_ENVIRONMENT','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of keys){if(old[k]===undefined) delete process.env[k];else process.env[k]=old[k];}delete globalThis.__iaWorkerTeste;});
 const logs=[];
 for(const method of ['info','warn','error']) t.mock.method(console,method,(...args)=>logs.push(args));
 const req=(header='Bearer segredo-fixture')=>new Request('http://localhost/api/cron/concessoes-financeiras?limite=999&ambiente=production',{headers:{authorization:header}});
 process.env.CRON_SECRET='segredo-fixture';process.env.FINANCEIRO_WORKER_ENABLED='true';process.env.ASAAS_ENVIRONMENT='sandbox';
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SECRET_KEY='chave-admin-fixture';
 assert.equal((await GET(req('Bearer errado'))).status,401);
 delete process.env.CRON_SECRET;assert.equal((await GET(req())).status,401);process.env.CRON_SECRET='segredo-fixture';
 delete process.env.SUPABASE_SECRET_KEY;assert.equal((await GET(req())).status,503);process.env.SUPABASE_SECRET_KEY='chave-admin-fixture';
 delete process.env.FINANCEIRO_WORKER_ENABLED;assert.equal((await GET(req())).status,503);process.env.FINANCEIRO_WORKER_ENABLED='true';
 assert.equal(state.calls,0);
 state.banco=banco();let response=await GET(req());assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(state.banco.calls[0].args.p_limite,10);assert.equal(state.banco.calls[0].args.p_ambiente,'sandbox');
 state.banco=banco('pending');response=await GET(req());assert.equal(response.status,503);
 assert.equal((await response.json()).pendentes,1);
 state.banco=banco(new Error('chave-admin-fixture'));response=await GET(req());
 assert.equal(response.status,503);
 assert.doesNotMatch(JSON.stringify(logs)+JSON.stringify(await response.json()),/segredo-fixture|chave-admin-fixture|20000000-/);
});

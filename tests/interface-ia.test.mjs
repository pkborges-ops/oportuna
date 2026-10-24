import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotsEquivalentes,nomeHistorico } from '../lib/analises/apresentacao.ts';
import { readFileSync } from 'node:fs';
test('snapshot ignora apenas espaços e ordem de chaves; preserva mudanças comerciais',()=>{
 assert.equal(snapshotsEquivalentes({a:'  Objeto  novo ',b:1},{b:1,a:'Objeto novo'}),true);
 assert.equal(snapshotsEquivalentes({valor:10},{valor:11}),false);
 assert.equal(snapshotsEquivalentes(null,{}),false);
 assert.equal(nomeHistorico({perfil:{nomeEmpresa:'Empresa antiga'}}),'Empresa antiga');
 assert.equal(nomeHistorico({}),undefined);
});
test('interface tem layout responsivo, foco, feedback e guarda de dupla submissão',()=>{
 const formulario=readFileSync('components/analises/formulario-ia.tsx','utf8');
 assert.match(formulario,/useFormStatus/); assert.match(formulario,/disabled=\{disabled \|\| pending\}/);
 assert.match(formulario,/enviando.current\) event.preventDefault/);
 assert.match(formulario,/role="status"/); assert.match(formulario,/aria-busy/);
 assert.match(formulario,/motion-reduce/); assert.match(formulario,/sm:w-fit/);
 const painel=readFileSync('components/analises/painel-ia.tsx','utf8');
 assert.match(painel,/grid-cols-2/);assert.match(painel,/sm:grid-cols-4/);
 assert.match(painel,/focus-visible/);assert.match(painel,/<dl/);
});

test('formulário bloqueia segundo submit e apresenta processamento acessível', async()=>{
 const {spawnSync}=await import('node:child_process');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--import','./tests/register.mjs','tests/helpers/ia-formulario-interacao.mjs'],{encoding:'utf8',env});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});

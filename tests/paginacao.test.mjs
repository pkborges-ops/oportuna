import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { casosMatching } from './helpers/matching-fixtures.mjs';
import { calcularMatch } from '../lib/matching/calcular-match.ts';
import { normalizarPagina, lerContexto, montarDestino, destinoLimparFiltros } from '../lib/matching/contexto.ts';

test('fixtures cobrem 38 cenários e fronteiras reais do matcher de referência', () => {
  assert.equal(casosMatching.length,38);
  for (const score of [39,40,69,70,98]) {
    const c = casosMatching.find(c=>c.nome === 'fronteira '+score);
    assert.equal(calcularMatch(c).score,score);
  }
  const sql = readFileSync('tests/sql/matching-paridade.sql','utf8');
  assert.match(sql,/matching_score_v1/);
  const migration = readFileSync('supabase/oportunidades_paginadas_v1.sql','utf8');
  assert.match(migration,/create or replace function public\.matching_preparar_score_v1/);
  assert.match(migration,/matching_score_v1\(palavras_score,segmento_score,uf_score,uf_score_valida/);
  for (const c of casosMatching) assert.ok(sql.includes(JSON.stringify(calcularMatch(c)).replaceAll("'","''")));
});
test('página valida inteiro positivo int32, inválido volta para 1', () => {
  for (const v of [undefined,'',0,-1,'1.5','2e3','abc',Infinity,2147483648]) assert.equal(normalizarPagina(v),1);
  assert.equal(normalizarPagina('2'),2);
  assert.equal(lerContexto({pagina:['2','3']}).pagina,1);
});
test('navegação preserva página; limpar filtros reinicia', () => {
  const contexto = {perfilId:'p1', pagina:3, ordenacao:'mais_novas'};
  assert.equal(montarDestino(contexto),'/oportunidades?perfilId=p1&ordenacao=mais_novas&pagina=3');
  assert.equal(destinoLimparFiltros(contexto),'/oportunidades?perfilId=p1');
});
test('lista e detalhe não chamam matcher TypeScript de referência', () => {
  for (const path of ['app/(painel)/oportunidades/page.tsx','app/(painel)/oportunidades/[id]/page.tsx']) {
    const texto = readFileSync(path,'utf8');
    assert.doesNotMatch(texto,/\bcalcularMatch\(|\bprepararListagem\(/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classificarSituacao, normalizarVisao } from '../lib/oportunidades/ciclo-vida.ts';
import { lerContexto, montarDestino, destinoLimparFiltros } from '../lib/matching/contexto.ts';

const agora = Date.parse('2026-09-29T12:00:00Z');
test('visão ausente, repetida ou inválida é ativas; histórico e todas são explícitas', () => {
  for (const v of [undefined, null, '', 'errada', ['historico','todas']]) {
    assert.equal(normalizarVisao(v), 'ativas');
    assert.equal(lerContexto({visao:v}).visao, 'ativas');
  }
  for (const v of ['ativas','historico','todas']) assert.equal(lerContexto({visao:v}).visao,v);
});
test('prazo vigente, vencido, instante limite, offsets e ausência conservadora', () => {
  for (const status of ['aberta','em_analise']) {
    assert.equal(classificarSituacao(status,'2026-09-29T12:00:01Z',agora),'ativa');
    assert.equal(classificarSituacao(status,'2026-09-29T08:59:59-03:00',agora),'encerrada');
    assert.equal(classificarSituacao(status,'2026-09-29T09:00:00-03:00',agora),'encerrada');
    for (const prazo of [null,undefined,'infinity','-infinity','inválido',''])
      assert.equal(classificarSituacao(status,prazo,agora),'indeterminada');
  }
  assert.equal(classificarSituacao('encerrada','2099-01-01T00:00:00Z',agora),'encerrada');
});
test('troca de visão/limpeza preserva perfil, histórico e filtros sem página antiga', () => {
  const c=lerContexto({visao:'historico',perfilId:'p1',uf:'SC',pagina:'9',busca:'software'});
  const url=new URL(montarDestino(c),'https://example.invalid');
  assert.equal(url.searchParams.get('pagina'),'9');
  assert.equal(url.searchParams.get('visao'),'historico');
  assert.equal(url.searchParams.get('perfilId'),'p1');
  const limpa=new URL(destinoLimparFiltros(c),'https://example.invalid');
  assert.equal(limpa.searchParams.get('visao'),'historico');
  assert.equal(limpa.searchParams.get('perfilId'),'p1');
  assert.equal(limpa.searchParams.get('pagina'),null);
});
test('migration não altera dados, matcher, status de origem ou políticas RLS', () => {
  const s=readFileSync('supabase/oportunidades_ciclo_vida_v1.sql','utf8');
  assert.doesNotMatch(s,/\b(delete\s+from|update\s+public|truncate|drop\s+table|disable\s+row\s+level|security\s+definer)\b/i);
  assert.doesNotMatch(s,/create or replace function public\.(matching_|listar_oportunidades_paginadas_v1)/);
  assert.match(s,/security_invoker=true/);
  assert.match(s,/matching_score_v1\(palavras_score,segmento_score,uf_score,uf_score_valida/);
});

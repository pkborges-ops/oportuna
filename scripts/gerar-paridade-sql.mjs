// Apenas gera um roteiro SQL. NÃO conecta a banco, NÃO aplica migrations.
// Execute: node --import ./tests/register.mjs scripts/gerar-paridade-sql.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { calcularMatch } from '../lib/matching/calcular-match.ts';
import { normalizarTexto } from '../lib/matching/normalizar-texto.ts';
import { casosMatching, textosNormalizacao } from '../tests/helpers/matching-fixtures.mjs';
const quote = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const fixtures = casosMatching.map(c=>({...c, esperado:calcularMatch(c)}));
const textos = textosNormalizacao.map(texto=>({texto,esperado:normalizarTexto(texto)}));
const sql = `-- GERADO por scripts/gerar-paridade-sql.mjs; não editar expectativas manualmente.
-- Executar MANUALMENTE após a migration em banco de homologação; sem dados de produção.
-- Nenhuma tabela é escrita por este roteiro.
begin;
do $test$
declare c jsonb; obtido jsonb; esperado jsonb; o jsonb; p jsonb; preparado jsonb;
  tokens text[]; palavras_score text[]; segmento_score text[]; uf_score text; uf_score_valida boolean; score integer;
begin
  for c in select * from jsonb_array_elements(${quote(fixtures)}) loop
    o := c->'oportunidade'; p := c->'perfil'; esperado := c->'esperado';
    preparado := public.matching_preparar_v1(array(select jsonb_array_elements_text(p->'palavrasChave')),p->>'segmento',p->>'uf');
    tokens := public.matching_tokens_v1(o->>'titulo',o->>'objeto',array(select jsonb_array_elements_text(o->'tags')),o->>'modalidade');
    obtido := public.matching_calcular_v1(preparado,tokens,o->>'uf');
    if obtido is distinct from esperado then
      raise exception 'Paridade falhou em %: esperado %, obtido %',c->>'nome',esperado,obtido;
    end if;
    select ps.palavras,ps.segmento,ps.uf,ps.uf_valida
      into palavras_score,segmento_score,uf_score,uf_score_valida
      from public.matching_preparar_score_v1(preparado) ps;
    score := public.matching_score_v1(palavras_score,segmento_score,uf_score,uf_score_valida,tokens,o->>'uf');
    if score is distinct from (esperado->>'score')::integer then
      raise exception 'Score scalar divergiu em %: esperado %, obtido %',c->>'nome',esperado->>'score',score;
    end if;
  end loop;
  for c in select * from jsonb_array_elements(${quote(textos)}) loop
    if public.matching_normalizar_v1(c->>'texto') is distinct from c->>'esperado' then
      raise exception 'Normalização divergente: %', c;
    end if;
  end loop;
  raise notice 'Paridade: ${fixtures.length} matches completos, score scalar e ${textos.length} normalizações OK';
end;
$test$;
rollback;
`;
const path = 'tests/sql/matching-paridade.sql';
if (process.argv.includes('--check')) {
  if (readFileSync(path,'utf8').replaceAll('\r\n','\n') !== sql) throw Error('Fixtures SQL desatualizadas');
} else writeFileSync(path,sql);

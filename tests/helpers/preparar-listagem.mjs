import { aplicarMatching } from '../../lib/matching/calcular-match.ts';
import { ordenarOportunidades } from '../../lib/matching/ordenar-oportunidades.ts';
// Apenas oráculo dos testes; produção recebe página e matcher do PostgreSQL.
export function prepararListagem(oportunidades, perfil, aderencia, ordenacao='recomendadas') {
  const resultados=perfil ? aplicarMatching(oportunidades,perfil) : oportunidades.map(oportunidade=>({oportunidade}));
  const filtrados=perfil && aderencia ? resultados.filter(({match})=>match?.nivel===aderencia) : resultados;
  return ordenarOportunidades(filtrados,ordenacao,Boolean(perfil));
}

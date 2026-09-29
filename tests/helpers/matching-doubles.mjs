// Double de contrato RPC, NÃO executa SQL e NÃO comprova paridade com PostgreSQL.
import { calcularMatch } from "../../lib/matching/calcular-match.ts";
import { ordenarOportunidades } from "../../lib/matching/ordenar-oportunidades.ts";
import { classificarSituacao } from "../../lib/oportunidades/ciclo-vida.ts";
export const state = { tables: {}, calls: [], aiCalls: 0, rpcRows: undefined, rpcError: null };
export function client() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    async rpc(name, args) {
      state.calls.push({ rpc: name, args, operation: "select" });
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (state.rpcRows !== undefined) return { data: state.rpcRows, error: null };
      const situacao = row => classificarSituacao(row.status, row.participacao_prazo_limite, Date.now());
      if (name === 'resumo_oportunidades_ativas_v1') {
        const all = state.tables.oportunidades_editais;
        const ativas = all.filter(o=>situacao(o)!=='encerrada');
        return {data:{total:ativas.length,totalBase:all.length,proxima:ativas[0] ? {
          ...ativas[0],valorEstimado:ativas[0].valor_estimado,dataAbertura:ativas[0].data_abertura,
        } : null},error:null};
      }
      const perfil = state.tables.perfis_empresa.find(p => p.id === args.p_perfil_id && p.usuario_id === 'u1');
      const toItem = row => {
        const oportunidade = { ...row, dataPublicacao:row.data_publicacao, dataAbertura:row.data_abertura,
          situacaoOperacional:situacao(row), participacao:{prazoLimite:row.participacao_prazo_limite},valorEstimado:row.valor_estimado };
        return { oportunidade, match: perfil ? calcularMatch({perfil:{...perfil,palavrasChave:perfil.palavras_chave},oportunidade}) : null,
          favorito:state.tables.oportunidades_favoritos.some(f=>f.usuario_id==='u1' && f.oportunidade_id===row.id) };
      };
      if (name === 'calcular_match_oportunidade_v1') {
        const row = state.tables.oportunidades_editais.find(o=>o.id===args.p_oportunidade_id);
        return {data:row ? toItem(row).match : null,error:null};
      }
      let rows = state.tables.oportunidades_editais.filter(o =>
        (args.p_visao==='todas' || (args.p_visao==='historico' ? situacao(o)==='encerrada' : situacao(o)!=='encerrada')) &&
        (!args.p_status || o.status===args.p_status) && (!args.p_uf || o.uf===args.p_uf) &&
        (!args.p_busca || ['titulo','orgao','modalidade','cidade','objeto'].some(k=>o[k]?.toLowerCase().includes(args.p_busca.toLowerCase()))));
      rows = rows.map(toItem).filter(o=>!perfil || !args.p_aderencia || o.match.nivel===args.p_aderencia);
      rows = ordenarOportunidades(rows,args.p_ordenacao,Boolean(perfil));
      if (args.p_ordenacao==='recomendadas') rows.sort((a,b)=>Number(a.oportunidade.situacaoOperacional==='encerrada')-Number(b.oportunidade.situacaoOperacional==='encerrada'));
      return {data: rows.slice((args.p_pagina-1)*20, (args.p_pagina-1)*20+21), error:null};
    },
    from(table) {
      const filters = [];
      let operation = "select",
        payload,
        single = false,
        orFilter, selectOptions, selection, limit;
      const q = {
        select(fields, options) {
          selection = fields;
          selectOptions = options;
          return q;
        },
        limit(value) { limit=value; return q; },
        eq(key, value) {
          filters.push([key, value]);
          return q;
        },
        in(key, values) {
          filters.push([key, values]);
          return q;
        },
        order() {
          return q;
        },
        or(value) {
          orFilter = value;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        delete() {
          operation = "delete";
          return q;
        },
        upsert(value) {
          operation = "upsert";
          payload = value;
          return q;
        },
        insert(value) {
          operation = "insert";
          payload = value;
          return q;
        },
        then(resolve, reject) {
          state.calls.push({ table, filters, operation, orFilter, payload, selectOptions, selection, limit });
          let rows = table==='oportunidades_ciclo_vida_v1'
            ? (state.tables.oportunidades_editais ?? []).map(o=>({...o,situacao_operacional:classificarSituacao(o.status,o.participacao_prazo_limite,Date.now())}))
            : state.tables[table] ?? [];
          const matches = (row) => filters.every(([k, v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v);
          if (operation === "insert" || operation === "upsert") {
            rows.push({ id: "nova-analise", ...payload });
          } else if (operation === "delete") {
            state.tables[table] = rows.filter((row) => !matches(row));
          }
          rows = rows.filter(matches);
          const count = rows.length;
          if (limit !== undefined) rows = rows.slice(0,limit);
          if (orFilter) {
            const term = orFilter.match(/ilike\.%(.*?)%/)[1].toLowerCase();
            rows = rows.filter((row) =>
              ["titulo", "orgao", "modalidade", "cidade", "objeto"].some((k) =>
                row[k]?.toLowerCase().includes(term),
              ),
            );
          }
          return Promise.resolve({
            data: single ? (rows[0] ?? null) : rows,
            error: null,
            count: selectOptions?.count ? count : null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

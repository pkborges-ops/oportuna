import test from 'node:test';
import assert from 'node:assert/strict';
import { transformarContratacao } from '../lib/oportunidades/normalizar-pncp.ts';
import { processarLotePncp } from '../services/sincronizacao-pncp-service.ts';
import { listarContratacoesPncp } from '../services/pncp-service.ts';

const compra = (modalidadeId = 6, extras = {}) => ({ modalidadeId,
  numeroControlePNCP: '12345678000190-1-000001/2026', dataPublicacaoPncp: '2026-09-18', ...extras });
for (const [id, tipo] of [[6, 'LICITACAO'], [4, 'LICITACAO'], [12, 'CREDENCIAMENTO']]) {
  test(`aceita modalidade ${id}`, () => assert.equal(transformarContratacao(compra(id)).tipo, tipo));
}
test('dispensa exige instrumento 2 + modo 4; rejeita ausência e conflito', () => {
  assert.equal(transformarContratacao(compra(8, { tipoInstrumentoConvocatorioId: 2, modoDisputaId: 4 })).tipo, 'CONTRATACAO_DIRETA');
  for (const extras of [{}, { tipoInstrumentoConvocatorioId: 2, modoDisputaId: 5 },
    { modoDisputaId: 4 }, { tipoInstrumentoConvocatorioId: 3, modoDisputaId: 4 },
    { tipoInstrumentoConvocatorioId: 2, modoDisputaId: 4, modoDisputaNome: 'Não se aplica' },
    { objetoCompra: 'Dispensa eletrônica com disputa' }]) {
    assert.equal(transformarContratacao(compra(8, extras)), null);
  }
});
test('persiste link e suporta ausência', () => {
  assert.equal(transformarContratacao(compra(6, { linkSistemaOrigem: 'https://compras.gov.br' })).participacao_url, 'https://compras.gov.br');
  assert.equal(transformarContratacao(compra()).participacao_url, null);
  assert.equal(transformarContratacao(compra()).participacao_portal, 'PNCP');
});
function ambiente({ falhaGravacao = false, falhaCheckpoint = false, final = false } = {}) {
  const cp = { modalidade_id: 6, modalidade_nome: 'Pregão - Eletrônico', pagina_proxima: 3,
    ciclo_concluido: false, data_final_ciclo: '20260918', reserva_token: 'token' };
  const registros = new Map();
  const eventos = [];
  const repo = {
    async reservar(data) {
      if (cp.ciclo_concluido) Object.assign(cp, { pagina_proxima: 1, ciclo_concluido: false, data_final_ciclo: data });
      return { ...cp };
    },
    async gravar(dados) { eventos.push('gravar'); if (falhaGravacao) throw Error('supabase');
      dados.forEach(d => registros.set(d.codigo, d)); },
    async concluir(_, pagina, concluido) { eventos.push('checkpoint'); if (falhaCheckpoint) throw Error('checkpoint');
      cp.pagina_proxima = pagina; cp.ciclo_concluido = concluido; },
  };
  const consultar = async (filtros) => { eventos.push('consultar'); assert.equal(filtros.uf, undefined);
    return { contratacoes: [compra()], totalPaginas: final ? filtros.pagina : 10 }; };
  return { cp, repo, consultar, eventos, registros };
}
test('avança só após upsert; uma página nacional por execução', async () => {
  const a = ambiente(); const r = await processarLotePncp('20260919', a.repo, a.consultar);
  assert.deepEqual(a.eventos, ['consultar', 'gravar', 'checkpoint']);
  assert.equal(a.cp.pagina_proxima, 4); assert.equal(r.paginasProcessadas, 1);
  assert.equal(r.paginaInicial, 3); assert.equal(r.proximaPagina, 4);
  assert.equal(a.cp.data_final_ciclo, '20260918');
});
for (const falha of ['pncp', 'upsert', 'checkpoint']) test(`falha ${falha} preserva página`, async () => {
  const a = ambiente({ falhaGravacao: falha === 'upsert', falhaCheckpoint: falha === 'checkpoint' });
  await assert.rejects(processarLotePncp('20260918', a.repo,
    falha === 'pncp' ? async () => { throw Error('pncp'); } : a.consultar));
  assert.equal(a.cp.pagina_proxima, 3);
  assert.equal(a.cp.ciclo_concluido, false);
});
test('fim marca conclusão; próxima reserva inicia novo ciclo com nova data', async () => {
  const a = ambiente({ final: true });
  const r = await processarLotePncp('20260918', a.repo, a.consultar);
  assert.equal(r.cicloConcluido, true); assert.equal(a.cp.pagina_proxima, 1);
  const novo = await processarLotePncp('20260919', a.repo, a.consultar);
  assert.equal(novo.paginaInicial, 1); assert.equal(a.cp.data_final_ciclo, '20260919');
});
test('repetição após falha do checkpoint mantém único código', async () => {
  const a = ambiente({ falhaCheckpoint: true });
  for (let i = 0; i < 2; i++) await assert.rejects(processarLotePncp('20260918', a.repo, a.consultar));
  assert.equal(a.registros.size, 1); assert.equal(a.cp.pagina_proxima, 3);
});
test('página com todas dispensas ignoradas avança após normalização', async () => {
  const a = ambiente(); a.cp.modalidade_id = 8;
  const r = await processarLotePncp('20260918', a.repo, async () => ({ contratacoes: [compra(8)], totalPaginas: 5 }));
  assert.equal(r.ignoradas, 1); assert.equal(r.gravadas, 0); assert.equal(a.cp.pagina_proxima, 4);
});
test('204 encerra ciclo, mas página vazia intermediária falha', async () => {
  const a = ambiente();
  await assert.rejects(processarLotePncp('20260918', a.repo, async () => ({ contratacoes: [], totalPaginas: 9 })));
  assert.equal(a.cp.pagina_proxima, 3);
  const r = await processarLotePncp('20260918', a.repo, async () => ({ contratacoes: [], totalPaginas: 0 }));
  assert.equal(r.cicloConcluido, true);
});
test('HTTP real do cliente omite UF e rejeita payload malformado', async (t) => {
  let malformado = false;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.searchParams.has('uf'), false);
    return new Response(JSON.stringify(malformado ? {} : { data: [], numeroPagina: 1, totalPaginas: 0 }));
  });
  await listarContratacoesPncp({ dataFinal: '20260918', codigoModalidadeContratacao: 6 });
  malformado = true;
  await assert.rejects(listarContratacoesPncp({ dataFinal: '20260918', codigoModalidadeContratacao: 6 }));
});

test('adapter usa conflito por codigo, timeout e token da reserva', async () => {
  const { criarRepositorioPncp } = await import('../services/sincronizacao-pncp-service.ts');
  const registros = new Map(); let tokenValido = true; const filtros = [];
  const cliente = {
    rpc(nome, args) { assert.equal(nome, 'reservar_lote_pncp'); assert.equal(args.nova_data_final, '20260918');
      return { async abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return { data: [{ modalidade_id: 6 }], error: null }; } }; },
    from(tabela) {
      const query = {
        upsert(dados, options) { assert.equal(tabela, 'oportunidades_editais'); assert.equal(options.onConflict, 'codigo');
          dados.forEach(d => registros.set(d.codigo, d)); return query; },
        update(dados) { assert.equal(tabela, 'sincronizacao_pncp_checkpoints'); assert.equal(dados.pagina_proxima, 4);
          assert.equal(dados.reserva_token, null); return query; },
        eq(campo, valor) { filtros.push([campo, valor]); return query; },
        select() { return query; },
        async abortSignal(signal) { assert.ok(signal instanceof AbortSignal);
          return { data: tokenValido ? [{ modalidade_id: 6 }] : [], error: null }; },
      }; return query;
    },
  };
  const repo = criarRepositorioPncp(cliente);
  await repo.reservar('20260918');
  await repo.gravar([transformarContratacao(compra())]);
  await repo.gravar([transformarContratacao(compra())]);
  assert.equal(registros.size, 1);
  await repo.concluir({ modalidade_id: 6, reserva_token: 'reserva-1' }, 4, false);
  assert.deepEqual(filtros, [['modalidade_id', 6], ['reserva_token', 'reserva-1']]);
  tokenValido = false;
  await assert.rejects(repo.concluir({ modalidade_id: 6, reserva_token: 'reserva-antiga' }, 4, false));
});
test('sem reserva disponível não consulta PNCP', async () => {
  const resultado = await processarLotePncp('20260918', { reservar: async () => null },
    async () => assert.fail('não deve consultar'));
  assert.equal(resultado.ocupado, true); assert.equal(resultado.paginasProcessadas, 0);
});
test('elimina códigos repetidos dentro da mesma página', async () => {
  const a = ambiente();
  const resultado = await processarLotePncp('20260918', a.repo, async () => ({
    contratacoes: [compra(), compra()], totalPaginas: 10,
  }));
  assert.equal(resultado.consultadas, 2); assert.equal(resultado.gravadas, 1);
});
test('nome de modalidade incompatível com a categoria não é importado', () => {
  assert.equal(transformarContratacao(compra(6, { modalidadeNome: 'Dispensa' })), null);
});

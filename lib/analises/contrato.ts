import { createHash } from "node:crypto";
import type { Opportunity, Profile } from "@/types";

export const VERSAO_ANALISE = "analise-v2-comercial-p1";
export type PontoAtencao = {
  titulo: string;
  classificacao: "fato_identificado" | "informacao_a_confirmar";
  explicacao: string;
  acao_recomendada: string;
};
export type ResultadoAnalise = {
  resumo: string;
  compatibilidade_empresa: string;
  pontos_atencao: PontoAtencao[];
  informacoes_nao_verificadas: string[];
  proximo_passo: string;
};
export class ErroGeracaoAnalise extends Error {
  constructor(public readonly codigo: string, public readonly incerta = false,
    public readonly metadados: Record<string, unknown> = {}) { super(codigo); }
}

const stringSchema = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
export const SCHEMA_ANALISE = {
  type: "object", additionalProperties: false,
  required: ["resumo", "compatibilidade_empresa", "pontos_atencao", "informacoes_nao_verificadas", "proximo_passo"],
  properties: {
    resumo: stringSchema(800), compatibilidade_empresa: stringSchema(800),
    pontos_atencao: { type: "array", maxItems: 5, items: {
      type: "object", additionalProperties: false,
      required: ["titulo", "classificacao", "explicacao", "acao_recomendada"],
      properties: {
        titulo: stringSchema(100),
        classificacao: { type: "string", enum: ["fato_identificado", "informacao_a_confirmar"] },
        explicacao: stringSchema(400), acao_recomendada: stringSchema(300),
      },
    } },
    informacoes_nao_verificadas: { type: "array", maxItems: 3, items: stringSchema(250) },
    proximo_passo: stringSchema(400),
  },
};

// Somente campos autorizados; sem CNPJ, score ou justificativas do matching.
export function prepararDadosAnalise(o: Opportunity, p: Profile) {
  const campo = (v: string | undefined, max = 300) => {
    if (v != null && (typeof v !== "string" || v.length > max)) throw new ErroGeracaoAnalise("ENTRADA_MUITO_GRANDE");
    return v?.trim() || null;
  };
  const lista = (v: string[]) => {
    if (!Array.isArray(v) || v.length > 30) throw new ErroGeracaoAnalise("ENTRADA_MUITO_GRANDE");
    return v.map(item => campo(item, 150)).filter(Boolean).sort();
  };
  const snapshot = {
    perfil: { nomeEmpresa: campo(p.nomeEmpresa), segmento: campo(p.segmento), porte: campo(p.porte),
      uf: campo(p.uf, 2), palavrasChave: lista(p.palavrasChave) },
    oportunidade: {
      titulo: campo(o.titulo, 1000), orgao: campo(o.orgao, 500), modalidade: campo(o.modalidade),
      uf: campo(o.uf, 2), cidade: campo(o.cidade), objeto: campo(o.objeto, 8000),
      valorEstimado: Number.isFinite(o.valorEstimado) ? o.valorEstimado : null,
      dataPublicacao: campo(o.dataPublicacao, 40), dataAbertura: campo(o.dataAbertura, 40),
      status: campo(o.status), situacaoOperacional: campo(o.situacaoOperacional),
      origem: campo(o.origem), tipo: campo(o.tipo), tags: lista(o.tags),
      participacao: o.participacao ? {
        portal: campo(o.participacao.portal), url: campo(o.participacao.url, 1500),
        forma: campo(o.participacao.forma, 1000), prazoLimite: campo(o.participacao.prazoLimite, 40),
        observacoes: campo(o.participacao.observacoes, 2000),
      } : null,
    },
  };
  const texto = JSON.stringify(snapshot);
  if (Buffer.byteLength(texto) > 24000) throw new ErroGeracaoAnalise("ENTRADA_MUITO_GRANDE");
  return { snapshot, hash: createHash("sha256").update(texto).digest("hex"), versao: VERSAO_ANALISE };
}

export function validarResultadoAnalise(value: unknown): ResultadoAnalise {
  const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const texto = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  const chaves = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  if (!objeto(value) || !chaves(value, SCHEMA_ANALISE.required) ||
    !texto(value.resumo, 800) || !texto(value.compatibilidade_empresa, 800) || !texto(value.proximo_passo, 400) ||
    !Array.isArray(value.informacoes_nao_verificadas) || value.informacoes_nao_verificadas.length > 3 ||
    !value.informacoes_nao_verificadas.every(v => texto(v, 250)) ||
    !Array.isArray(value.pontos_atencao) || value.pontos_atencao.length > 5 ||
    !value.pontos_atencao.every(v => objeto(v) && chaves(v, ["titulo", "classificacao", "explicacao", "acao_recomendada"]) &&
      texto(v.titulo, 100) && texto(v.explicacao, 400) && texto(v.acao_recomendada, 300) &&
      ["fato_identificado", "informacao_a_confirmar"].includes(v.classificacao as string))) {
    throw new ErroGeracaoAnalise("RESULTADO_INVALIDO");
  }
  return value as ResultadoAnalise;
}

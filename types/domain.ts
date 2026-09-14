export type ProfileStatus = "ativo" | "inativo";

export type CompanySize = "MEI" | "ME" | "EPP" | "Media" | "Grande";

export type Profile = {
  id: string;
  nomeEmpresa: string;
  cnpj: string;
  segmento: string;
  porte: CompanySize;
  uf: string;
  palavrasChave: string[];
  status: ProfileStatus;
  criadoEm: string;
};

export type OpportunityStatus = "aberta" | "em_analise" | "encerrada";

export type Opportunity = {
  id: string;
  codigo: string;
  titulo: string;
  orgao: string;
  modalidade: string;
  uf: string;
  cidade: string;
  objeto: string;
  valorEstimado: number;
  dataPublicacao: string;
  dataAbertura: string;
  status: OpportunityStatus;
  tags: string[];
  favorito: boolean;
  participacao?: OpportunityParticipation;
  perfilRecomendadoId?: string;
  analise?: MatchAnalysis;
};

export type OpportunityParticipation = {
  portal?: string;
  url?: string;
  forma?: string;
  prazoLimite?: string;
  observacoes?: string;
};

export type MatchAnalysis = {
  opportunityId: string;
  profileId: string;
  score: number;
  resumo: string;
  pontosFortes: string[];
  riscos: string[];
  recomendacao: string;
};

export type OpportunityAIAnalysis = {
  id: string;
  oportunidadeId: string;
  perfilId: string;
  score: number;
  justificativa: string;
  resumo: string;
  pontosAtencao: string[];
  criadoEm: string;
};

export type AlertFrequency = "diaria" | "semanal";

export type AlertStatus = "ativo" | "inativo";

export type AlertLastStatus =
  | "nunca_executado"
  | "simulado"
  | "enviado"
  | "sem_oportunidades"
  | "erro";

export type ProfileAlert = {
  id?: string;
  perfilId: string;
  emailDestino: string;
  frequencia: AlertFrequency;
  scoreMinimo: number;
  ativo: boolean;
  ultimaExecucaoEm?: string;
  ultimaQuantidadeConsiderada: number;
  ultimaQuantidadeEnviada: number;
  ultimoStatus: AlertLastStatus;
  ultimoErro?: string;
};

export type AlertHistory = {
  id: string;
  perfilId: string;
  oportunidadeId: string;
  tituloOportunidade: string;
  score: number;
  status: "simulado" | "enviado" | "erro";
  detalhes?: string;
  enviadoEm: string;
};

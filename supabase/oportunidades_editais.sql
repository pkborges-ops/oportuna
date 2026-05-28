-- Execute no Supabase em SQL Editor > New query.
-- Oportunidades ficam disponiveis para usuarios autenticados; favoritos sao privados por usuario.

create extension if not exists pgcrypto;

create table if not exists public.oportunidades_editais (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  titulo text not null,
  orgao text not null,
  modalidade text not null,
  uf char(2) not null,
  cidade text not null,
  objeto text not null,
  valor_estimado numeric(14, 2) not null default 0,
  data_publicacao date not null,
  data_abertura date not null,
  status text not null check (status in ('aberta', 'em_analise', 'encerrada')),
  tags text[] not null default '{}',
  score integer check (score between 0 and 100),
  analise_resumo text,
  analise_pontos_fortes text[] not null default '{}',
  analise_riscos text[] not null default '{}',
  analise_recomendacao text,
  participacao_portal text,
  participacao_url text,
  participacao_forma text,
  participacao_prazo_limite timestamptz,
  participacao_observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.oportunidades_favoritos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  oportunidade_id uuid not null references public.oportunidades_editais(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, oportunidade_id)
);

create index if not exists oportunidades_editais_status_idx
  on public.oportunidades_editais (status);

create index if not exists oportunidades_editais_data_abertura_idx
  on public.oportunidades_editais (data_abertura);

create index if not exists oportunidades_favoritos_usuario_idx
  on public.oportunidades_favoritos (usuario_id);

create or replace function public.atualizar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists oportunidades_editais_atualizado_em on public.oportunidades_editais;

create trigger oportunidades_editais_atualizado_em
before update on public.oportunidades_editais
for each row
execute function public.atualizar_atualizado_em();

alter table public.oportunidades_editais enable row level security;
alter table public.oportunidades_favoritos enable row level security;

drop policy if exists "Usuarios autenticados leem oportunidades" on public.oportunidades_editais;
drop policy if exists "Usuarios leem seus favoritos" on public.oportunidades_favoritos;
drop policy if exists "Usuarios criam seus favoritos" on public.oportunidades_favoritos;
drop policy if exists "Usuarios excluem seus favoritos" on public.oportunidades_favoritos;

create policy "Usuarios autenticados leem oportunidades"
on public.oportunidades_editais
for select
to authenticated
using (true);

create policy "Usuarios leem seus favoritos"
on public.oportunidades_favoritos
for select
to authenticated
using (usuario_id = auth.uid());

create policy "Usuarios criam seus favoritos"
on public.oportunidades_favoritos
for insert
to authenticated
with check (usuario_id = auth.uid());

create policy "Usuarios excluem seus favoritos"
on public.oportunidades_favoritos
for delete
to authenticated
using (usuario_id = auth.uid());

insert into public.oportunidades_editais (
  codigo,
  titulo,
  orgao,
  modalidade,
  uf,
  cidade,
  objeto,
  valor_estimado,
  data_publicacao,
  data_abertura,
  status,
  tags,
  score,
  analise_resumo,
  analise_pontos_fortes,
  analise_riscos,
  analise_recomendacao
)
values
  (
    'op-001',
    'Pregão eletrônico 42/2026',
    'Secretaria Municipal de Administracao',
    'Pregão eletrônico',
    'SP',
    'Campinas',
    'Contratação de plataforma SaaS para gestão documental, protocolo digital e assinatura eletrônica.',
    480000,
    '2026-05-18',
    '2026-06-12',
    'aberta',
    array['software', 'assinatura eletrônica', 'gestão documental'],
    92,
    'Alta aderência ao portfólio da empresa, com exigências técnicas compatíveis e prazo adequado para preparação da proposta.',
    array[
      'Objeto alinhado com SaaS e gestão documental.',
      'Exigencias de integracao dentro do escopo atual.',
      'Valor estimado compatível com contratos anteriores.'
    ],
    array[
      'Necessidade de confirmar SLA minimo no termo de referencia.',
      'Validar exigencia de atestados por volume de usuarios.'
    ],
    'Priorizar leitura do edital completo e iniciar matriz de conformidade técnica.'
  ),
  (
    'op-002',
    'Concorrencia 08/2026',
    'Departamento Estadual de Infraestrutura',
    'Concorrencia',
    'MG',
    'Belo Horizonte',
    'Elaboracao de projetos executivos e fiscalizacao de obras de modernizacao viaria.',
    1250000,
    '2026-05-16',
    '2026-06-20',
    'em_analise',
    array['engenharia', 'fiscalizacao', 'infraestrutura'],
    78,
    'Boa aderência técnica, mas requer validação detalhada de acervo e equipe mínima exigida.',
    array[
      'Experiencia previa em fiscalizacao de obras.',
      'Atuação regional compatível com o edital.'
    ],
    array[
      'Possível exigência de responsáveis técnicos dedicados.',
      'Cronograma de mobilizacao pode pressionar margem.'
    ],
    'Avaliar documentacao de acervo e disponibilidade da equipe antes de favoritar.'
  ),
  (
    'op-003',
    'Dispensa eletrônica 119/2026',
    'Instituto Federal do Parana',
    'Dispensa eletrônica',
    'PR',
    'Curitiba',
    'Aquisição de licenças de ferramenta de atendimento digital com relatórios gerenciais.',
    96000,
    '2026-05-20',
    '2026-05-29',
    'aberta',
    array['atendimento digital', 'licenças', 'relatórios'],
    84,
    'Oportunidade de ciclo curto com bom encaixe comercial para oferta SaaS padronizada.',
    array[
      'Baixa complexidade de implantacao.',
      'Escopo compatível com produto existente.'
    ],
    array[
      'Prazo reduzido para envio de proposta.',
      'Margem depende de precificação de licenças.'
    ],
    'Preparar proposta comercial padrao e revisar requisitos de suporte.'
  )
on conflict (codigo) do update set
  titulo = excluded.titulo,
  orgao = excluded.orgao,
  modalidade = excluded.modalidade,
  uf = excluded.uf,
  cidade = excluded.cidade,
  objeto = excluded.objeto,
  valor_estimado = excluded.valor_estimado,
  data_publicacao = excluded.data_publicacao,
  data_abertura = excluded.data_abertura,
  status = excluded.status,
  tags = excluded.tags,
  score = excluded.score,
  analise_resumo = excluded.analise_resumo,
  analise_pontos_fortes = excluded.analise_pontos_fortes,
  analise_riscos = excluded.analise_riscos,
  analise_recomendacao = excluded.analise_recomendacao;

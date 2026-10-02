-- MANUAL: executar inteiro SOMENTE em homologação após planos_e_permissoes_v1.sql.
-- Cria usuários/itens sintéticos numa transação. Nenhum dado fica gravado: ROLLBACK.
-- O bloco troca para authenticated; resultados feitos apenas como postgres não bastam.
begin;
set local statement_timeout='120s';
do $homologacao$
declare
  f record;
  bloqueado boolean;
  reserva uuid;
  item record;
  qtd integer;
begin
  if has_function_privilege('authenticated',
      'public.listar_oportunidades_paginadas_v1(uuid,text,text,text,text,text,integer)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.matching_calcular_v1(jsonb,text[],text)','EXECUTE') then
    raise exception 'RPC/helper legado ainda permite contornar cota'; end if;
  create temporary table plano_fixture(
    a uuid,b uuid,pa uuid,pb1 uuid,pb2 uuid,pb3 uuid,prefixo text
  );
  insert into plano_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'planos-'||gen_random_uuid());
  grant select on pg_temp.plano_fixture to authenticated;
  select * into f from plano_fixture;
  insert into auth.users(id,email) values
    (f.a,f.a||'@example.invalid'),(f.b,f.b||'@example.invalid');
  -- O gatilho criou Free; removemos A para provar o fallback de usuários antigos.
  delete from public.assinaturas_usuario where usuario_id=f.a;
  update public.assinaturas_usuario set plano='PRO',franquia_ia=2 where usuario_id=f.b;

  create temporary table plano_itens(n integer primary key,id uuid);
  insert into plano_itens select n,gen_random_uuid() from generate_series(1,26)n;
  grant select on pg_temp.plano_itens to authenticated;
  insert into public.oportunidades_editais(id,codigo,origem,tipo,titulo,orgao,modalidade,
    uf,cidade,objeto,data_publicacao,data_abertura,status,participacao_prazo_limite)
  select i.id,f.prefixo||'-'||i.n,'PNCP','LICITACAO',f.prefixo||' '||
    case when i.n=26 then 'software tecnologia' else 'material' end,
    'Órgão','Pregão','SP','Cidade',case when i.n=26 then 'software tecnologia' else 'material' end,
    case when i.n=26 then current_date-20 else current_date end,
    current_date+1,'aberta',now()+interval '10 days'
  from plano_itens i;
  -- Uma histórica recente, uma antiga e uma ativa publicada há mais de 30 dias.
  create temporary table plano_datas(tipo text,id uuid);
  insert into plano_datas values('recente',gen_random_uuid()),('antiga',gen_random_uuid()),('ativa_antiga',gen_random_uuid());
  grant select on pg_temp.plano_datas to authenticated;
  insert into public.oportunidades_editais(id,codigo,origem,tipo,titulo,orgao,modalidade,
    uf,cidade,objeto,data_publicacao,data_abertura,status,participacao_prazo_limite)
  select d.id,f.prefixo||'-'||d.tipo,'PNCP','LICITACAO',f.prefixo||' '||d.tipo,
    'Órgão','Pregão','SP','Cidade','material',
    case when d.tipo='recente' then current_date-10 else current_date-70 end,
    current_date-1,case when d.tipo='ativa_antiga' then 'aberta' else 'encerrada' end,
    case when d.tipo='recente' then now()-interval '5 days'
      when d.tipo='antiga' then now()-interval '40 days' else now()+interval '10 days' end
  from plano_datas d;

  perform set_config('request.jwt.claim.sub',f.a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.a,'role','authenticated')::text,true);
  set local role authenticated;
  if current_user<>'authenticated' or auth.uid() is distinct from f.a then
    raise exception 'Contexto A inválido'; end if;
  if public.plano_atual_v1()<>'FREE' then raise exception 'Fallback Free falhou'; end if;
  if exists(select 1 from public.assinaturas_usuario where usuario_id=f.b) then
    raise exception 'RLS expôs plano de B'; end if;
  bloqueado:=false;
  begin update public.assinaturas_usuario set plano='PRO' where usuario_id=f.a;
  exception when insufficient_privilege then bloqueado:=true; end;
  if not bloqueado then raise exception 'A alterou seu próprio plano'; end if;
  insert into public.eventos_plano(usuario_id,evento) values(f.a,'viu_planos');

  insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf,palavras_chave)
    values(f.pa,f.a,'Teste A','00000000000001','tecnologia','ME','SP',array['software']);
  bloqueado:=false;
  begin
    insert into public.perfis_empresa(usuario_id,nome_empresa,cnpj,segmento,porte,uf)
      values(f.a,'Segundo','00000000000002','tecnologia','ME','SP');
  exception when sqlstate 'P0001' then bloqueado:=true; end;
  if not bloqueado then raise exception 'Free criou segundo perfil'; end if;

  insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
    select f.a,id from plano_itens where n<=5;
  bloqueado:=false;
  begin
    insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
      select f.a,id from plano_itens where n=6;
  exception when sqlstate 'P0001' then bloqueado:=true; end;
  if not bloqueado then raise exception 'Free criou sexto favorito'; end if;
  insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
    select f.a,id from plano_itens where n=1 on conflict do nothing;
  select count(*) into qtd from public.oportunidades_favoritos where usuario_id=f.a;
  if qtd<>5 then raise exception 'Upsert de favorito existente alterou total'; end if;

  select * into item from plano_itens where n=26;
  if (select oportunidade->>'id' from public.listar_oportunidades_paginadas_v2(
      f.pa,f.prefixo,null,null,null,'maior_aderencia',1,'ativas') limit 1)<>item.id::text then
    raise exception 'Ranking global não colocou oportunidade aderente primeiro'; end if;
  if exists(select 1 from public.listar_oportunidades_paginadas_v2(
      f.pa,f.prefixo,null,null,null,'maior_aderencia',1,'ativas') where match is not null) then
    raise exception 'Score Free vazou antes do desbloqueio'; end if;
  if public.calcular_match_oportunidade_v1(f.pa,item.id) is not null then
    raise exception 'Detalhe Free vazou score'; end if;
  -- O desbloqueio de ontem não ocupa uma vaga hoje.
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  insert into public.score_desbloqueios(usuario_id,perfil_id,oportunidade_id,dia)
    values(f.a,f.pa,item.id,public.plano_dia_v1()-1);
  perform set_config('request.jwt.claim.sub',f.a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.a,'role','authenticated')::text,true);
  set local role authenticated;
  if not public.desbloquear_score_v1(f.pa,item.id) or not public.desbloquear_score_v1(f.pa,item.id) then
    raise exception 'Desbloqueio/idempotência falhou'; end if;
  if public.calcular_match_oportunidade_v1(f.pa,item.id) is null then
    raise exception 'Score desbloqueado não apareceu'; end if;
  perform public.desbloquear_score_v1(f.pa,(select id from plano_itens where n=1));
  perform public.desbloquear_score_v1(f.pa,(select id from plano_itens where n=2));
  if public.desbloquear_score_v1(f.pa,(select id from plano_itens where n=3)) then
    raise exception 'Free passou de 3 scores no dia'; end if;
  select count(*) into qtd from public.score_desbloqueios where usuario_id=f.a and dia=public.plano_dia_v1();
  if qtd<>3 then raise exception 'Contador diário de score incorreto'; end if;

  reserva:=public.reservar_analise_ia_v1(f.pa,(select id from plano_itens where n=4));
  if reserva is null or public.reservar_analise_ia_v1(f.pa,(select id from plano_itens where n=5)) is not null then
    raise exception 'Reserva IA concorrente não respeitou cota'; end if;
  perform public.liberar_reserva_ia_v1(reserva);
  reserva:=public.reservar_analise_ia_v1(f.pa,(select id from plano_itens where n=5));
  if reserva is null then raise exception 'Erro de IA consumiu cota'; end if;
  perform public.liberar_reserva_ia_v1(reserva);
  insert into public.analises_oportunidades(usuario_id,oportunidade_id,perfil_id,score,justificativa,resumo)
    values(f.a,(select id from plano_itens where n=4),f.pa,70,'Teste','Teste');
  bloqueado:=false;
  begin
    insert into public.analises_oportunidades(usuario_id,oportunidade_id,perfil_id,score,justificativa,resumo)
      values(f.a,(select id from plano_itens where n=5),f.pa,70,'Teste','Teste');
  exception when sqlstate 'P0001' then bloqueado:=true; end;
  if not bloqueado then raise exception 'Free criou segunda análise IA'; end if;
  if public.reservar_analise_ia_v1(f.pa,(select id from plano_itens where n=5)) is not null then
    raise exception 'Reserva após franquia IA esgotada'; end if;
  delete from public.analises_oportunidades where usuario_id=f.a;
  if public.reservar_analise_ia_v1(f.pa,(select id from plano_itens where n=5)) is not null then
    raise exception 'Excluir análise devolveu cota IA consumida'; end if;
  if (select count(*) from public.analises_ia_consumos where usuario_id=f.a)<>1 then
    raise exception 'Histórico de consumo IA não foi preservado'; end if;

  if exists(select 1 from public.oportunidades_editais where id=(select id from plano_datas where tipo='antiga'))
    or not exists(select 1 from public.oportunidades_editais where id=(select id from plano_datas where tipo='recente'))
    or not exists(select 1 from public.oportunidades_editais where id=(select id from plano_datas where tipo='ativa_antiga')) then
    raise exception 'RLS de histórico Free incorreta'; end if;
  if exists(select 1 from public.listar_oportunidades_paginadas_v2(null,f.prefixo,null,null,null,'mais_novas',1,'todas')
    where (oportunidade->>'id')::uuid=(select id from plano_datas where tipo='antiga')) then
    raise exception 'Visão Todas contornou histórico Free'; end if;
  if exists(select 1 from public.listar_oportunidades_paginadas_v2(null,f.prefixo,null,null,null,'mais_novas',1,'historico')
    where (oportunidade->>'id')::uuid=(select id from plano_datas where tipo='antiga')) then
    raise exception 'Visão Histórico contornou limite Free'; end if;
  reset role;

  -- Simula configuração legada ativa: ela permanece armazenada para upgrade futuro.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  insert into public.alertas_perfis(usuario_id,perfil_id,email_destino,ativo)
    values(f.a,f.pa,'teste@example.invalid',true);
  perform set_config('request.jwt.claim.sub',f.a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.a,'role','authenticated')::text,true);
  set local role authenticated;
  bloqueado:=false;
  begin
    update public.alertas_perfis set ativo=true where usuario_id=f.a;
  exception when sqlstate 'P0001' then bloqueado:=true; end;
  if not bloqueado then raise exception 'Free reativou alerta'; end if;
  if not exists(select 1 from public.alertas_perfis where usuario_id=f.a and ativo) then
    raise exception 'Configuração legada foi apagada/desativada'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',f.b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.b,'role','authenticated')::text,true);
  set local role authenticated;
  if public.plano_atual_v1()<>'PRO' then raise exception 'Plano Pro não resolvido'; end if;
  if exists(select 1 from public.assinaturas_usuario where usuario_id=f.a) then
    raise exception 'B leu assinatura de A'; end if;
  if exists(select 1 from public.eventos_plano where usuario_id=f.a) then
    raise exception 'B leu eventos de A'; end if;
  bloqueado:=false;
  begin
    insert into public.eventos_plano(usuario_id,evento) values(f.a,'viu_planos');
  exception when insufficient_privilege then bloqueado:=true; end;
  if not bloqueado then raise exception 'B registrou evento de A'; end if;
  insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf)
    values(f.pb1,f.b,'Pro 1','00000000000001','tecnologia','ME','SP'),
      (f.pb2,f.b,'Pro 2','00000000000002','tecnologia','ME','SP'),
      (f.pb3,f.b,'Pro 3','00000000000003','tecnologia','ME','SP');
  bloqueado:=false;
  begin
    insert into public.perfis_empresa(usuario_id,nome_empresa,cnpj,segmento,porte,uf)
      values(f.b,'Pro 4','00000000000004','tecnologia','ME','SP');
  exception when sqlstate 'P0001' then bloqueado:=true; end;
  if not bloqueado then raise exception 'Pro criou quarto perfil'; end if;
  insert into public.oportunidades_favoritos(usuario_id,oportunidade_id)
    select f.b,id from plano_itens where n<=6;
  select count(*) into qtd from public.oportunidades_favoritos where usuario_id=f.b;
  if qtd<>6 then raise exception 'Favoritos Pro limitados'; end if;
  insert into public.alertas_perfis(usuario_id,perfil_id,email_destino,ativo)
    values(f.b,f.pb1,'teste@example.invalid',true);
  if not exists(select 1 from public.oportunidades_editais where id=(select id from plano_datas where tipo='antiga'))
    or not exists(select 1 from public.listar_oportunidades_paginadas_v2(null,f.prefixo,null,null,null,'mais_novas',1,'historico')
      where (oportunidade->>'id')::uuid=(select id from plano_datas where tipo='antiga')) then
    raise exception 'Pro perdeu histórico completo'; end if;
  if public.calcular_match_oportunidade_v1(f.pb1,(select id from plano_itens where n=26)) is null then
    raise exception 'Score Pro indisponível'; end if;
  begin
    perform public.calcular_match_oportunidade_v1(f.pa,(select id from plano_itens where n=26));
    raise exception 'Perfil de A acessível por B';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.listar_oportunidades_paginadas_v2(
      f.pa,f.prefixo,null,null,null,'maior_aderencia',1,'ativas');
    raise exception 'B listou oportunidades com perfil de A';
  exception when insufficient_privilege then null; end;
  begin
    perform public.desbloquear_score_v1(f.pa,(select id from plano_itens where n=26));
    raise exception 'B desbloqueou score com perfil de A';
  exception when insufficient_privilege then null; end;
  insert into public.analises_oportunidades(usuario_id,oportunidade_id,perfil_id,score,justificativa,resumo)
    values(f.b,(select id from plano_itens where n=1),f.pb1,70,'Teste','Teste'),
      (f.b,(select id from plano_itens where n=2),f.pb1,70,'Teste','Teste');
  bloqueado:=false;
  begin
    insert into public.analises_oportunidades(usuario_id,oportunidade_id,perfil_id,score,justificativa,resumo)
      values(f.b,(select id from plano_itens where n=3),f.pb1,70,'Teste','Teste');
  exception when sqlstate 'P0001' then bloqueado:=true; end;
  if not bloqueado then raise exception 'Franquia IA Pro configurada foi ultrapassada'; end if;
  raise notice 'PASS: planos, RLS A/B, perfis, favoritos, score, IA, alertas, histórico e ranking';
  reset role;
end;
$homologacao$;
rollback;

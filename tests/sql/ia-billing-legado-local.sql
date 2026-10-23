-- Após IA v1/v2, antes do adapter. Fixtures históricas, não créditos financeiros.
create table public.ia_test_antes_adapter(tipo text primary key, dados jsonb);
do $$
declare u uuid:='00000000-0000-0000-0000-000000000091'; e uuid; t uuid;
begin
 insert into auth.users values(u,'legado@example.invalid');
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf)
 values(u,u,'Legado','legado','TI','ME','SP');
 insert into public.oportunidades_editais(id,codigo,titulo,orgao,modalidade,uf,cidade,objeto,data_publicacao,data_abertura,status)
 values('20000000-0000-0000-0000-000000000091','legado','Objeto','Órgão','Pregão','SP','SP','Objeto',current_date,current_date,'aberta');
 update public.assinaturas_usuario set plano='PRO',franquia_ia=4,fim_em=now()+interval '1 day' where usuario_id=u;
 perform public.ia_autorizar_ciclo_v1(u,'manual-antiga','ciclo-antigo',now()-interval '1 day',now()+interval '1 day');
 e:=(public.ia_reservar_v1(u,u,'20000000-0000-0000-0000-000000000091',repeat('a',64),'analise-v1-integridade','{}')->>'execucao_id')::uuid;
 t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 perform public.ia_finalizar_v1(u,e,t,'{"score":73,"resumo":"Histórico v1","justificativa":"Original","pontos_atencao":["Original"]}');
 -- Reserva não iniciada deve sobreviver à instalação sem ser remapeada.
 perform public.ia_reservar_v1(u,u,'20000000-0000-0000-0000-000000000091',repeat('b',64),'analise-v1-integridade','{}');
 insert into public.ia_test_antes_adapter
 select 'resultados',jsonb_agg(to_jsonb(r) order by execucao_id) from public.ia_resultados_v1 r
 union all select 'execucoes',jsonb_agg(to_jsonb(r) order by id) from public.ia_execucoes_v1 r
 union all select 'consumos',jsonb_agg(to_jsonb(r) order by execucao_id) from public.ia_consumos_v1 r
 union all select 'ciclos',jsonb_agg(to_jsonb(r) order by id) from public.ia_ciclos_v1 r;
end $$;

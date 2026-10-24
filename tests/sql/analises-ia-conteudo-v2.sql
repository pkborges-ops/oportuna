\set ON_ERROR_STOP on
-- A migration foi aplicada depois de criar resultados v1 reais.
select public.ia_test_assert(exists(select 1 from public.ia_resultados_v1 where versao_schema=1 and score=70 and conteudo is null),'histórico v1 preservado');
insert into auth.users values('00000000-0000-0000-0000-000000000010');
insert into public.perfis_empresa(id,usuario_id,nome_empresa,cnpj,segmento,porte,uf)
values('10000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000010','Empresa','10','TI','ME','SP');
do $$
declare u uuid:='00000000-0000-0000-0000-000000000010'; e uuid; t uuid; r jsonb; bad jsonb;
v jsonb:='{"resumo":"Software","compatibilidade_empresa":"Segmento TI corresponde ao objeto.","pontos_atencao":[{"titulo":"Prazo","classificacao":"informacao_a_confirmar","explicacao":"Não informado.","acao_recomendada":"Consultar portal."}],"informacoes_nao_verificadas":["Prazo não disponibilizado."],"proximo_passo":"Confirmar prazo no portal."}';
begin
 perform public.ia_test_assert(public.ia_resultado_valido_v2(v),'contrato v2 válido');
 foreach bad in array array[
   v||'{"score":50}'::jsonb,v||'{"resumo":" "}'::jsonb,v-'proximo_passo',
   v||'{"pontos_atencao":["P"]}'::jsonb,v||'{"pontos_atencao":null}'::jsonb,
   jsonb_set(v,'{pontos_atencao,0,classificacao}','"inventado"'),
   jsonb_set(v,'{pontos_atencao,0,titulo}','""')
 ] loop
   perform public.ia_test_assert(not public.ia_resultado_valido_v2(bad),'rejeita contrato inválido');
 end loop;
 e:=(public.ia_reservar_v1(u,'10000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001',repeat('a',64),'analise-v2-comercial-p1','{}')->>'execucao_id')::uuid;
 t:=(public.ia_iniciar_v1(u,e)->>'token')::uuid;
 begin
   perform public.ia_finalizar_v1(u,e,t,v||'{"score":90}');
   raise exception 'aceitou score';
 exception when raise_exception then
   if sqlerrm<>'Resultado v2 inválido' then raise; end if;
 end;
 perform public.ia_test_assert((select count(*)=0 from public.ia_consumos_v1 where execucao_id=e),'inválido não consome');
 perform public.ia_test_assert((select estado='processing' from public.ia_execucoes_v1 where id=e),'validação não destrói reserva');
 r:=public.ia_finalizar_v1(u,e,t,v,'{"resposta_id":"resp_mock","versao_prompt":"analise-v2-comercial-p1","output_tokens":150}');
 perform public.ia_test_assert(r->>'codigo'='CONCLUIDA','v2 concluída');
 perform public.ia_finalizar_v1(u,e,t,v);
 perform public.ia_test_assert((select count(*)=1 from public.ia_consumos_v1 where execucao_id=e),'v2 consumo único');
 perform public.ia_test_assert((select versao_schema=2 and score is null and justificativa is null and pontos_atencao is null and conteudo=v from public.ia_resultados_v1 where execucao_id=e),'v2 não fabrica score');
 perform public.ia_test_assert((select metadados->>'resposta_id'='resp_mock' from public.ia_execucoes_v1 where id=e),'metadados persistidos');
end $$;
select public.ia_test_assert(not has_function_privilege('authenticated','public.ia_finalizar_v1(uuid,uuid,uuid,jsonb,jsonb,boolean)','execute'),'finalização permanece privada');
select public.ia_test_assert(has_function_privilege('service_role','public.ia_finalizar_v1(uuid,uuid,uuid,jsonb,jsonb,boolean)','execute'),'finalização backend preservada');
select public.ia_test_assert(not has_function_privilege('authenticated','public.ia_resultado_valido_v2(jsonb)','execute'),'helper privado');
\echo PASS conteúdo v2, histórico, validação, consumo e privilégios

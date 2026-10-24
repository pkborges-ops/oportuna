\set ON_ERROR_STOP on
-- Fixtures sintéticas, apenas após os helpers da suíte integrada.
do $homologacao$
declare u uuid; s uuid; g uuid; futuro uuid; c uuid; e uuid; plano text; quota integer;
 d date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;
begin
 foreach plano in array array['PRO','BUSINESS'] loop
  quota:=case plano when 'PRO' then 200 else 1000 end;
  u:=public.ia_test_usuario(); s:=public.ia_test_assinatura(u,plano,quota,d);
  perform public.ia_test_pagamento(s,'atual_'||s,d,'PAYMENT_RECEIVED');
  perform public.ia_test_entregar();
  perform public.ia_test_check(not exists(select 1 from public.ia_ciclos_v1 where usuario_id=u),plano||' sem confirmação não ganha franquia paga');
  g:=public.ia_test_pagamento(s,'atual_'||s,d); perform public.ia_test_entregar();
  select ciclo_id into c from public.ia_concessoes_financeiras_v1 where concessao_id=g;
  perform public.ia_test_check((select limite=quota from public.ia_ciclos_v1 where id=c),plano||' franquia exata '||quota);
  futuro:=public.ia_test_pagamento(s,'futuro_'||s,(d+interval '1 month')::date);
  perform public.ia_test_entregar();
  perform public.ia_test_pagamento(s,'futuro_'||s,(d+interval '1 month')::date,'PAYMENT_REFUNDED');
  perform public.ia_test_entregar();
  perform public.ia_test_check((public.ia_ciclo_atual_v1(u)).id=c,plano||' estorno futuro preserva concessão vigente');
  perform public.ia_test_check((select estado='REVOKED' from public.ia_concessoes_financeiras_v1 where concessao_id=futuro),plano||' futuro revogado');
  e:=(public.ia_test_reserva(u)->>'execucao_id')::uuid;
  perform public.ia_test_check(public.ia_test_concluir(u,e)->>'codigo'='CONCLUIDA',plano||' consome período anterior após estorno futuro');
  perform public.ia_test_check((select count(*)=1 from public.ia_consumos_v1 where ciclo_id=c),plano||' exatamente um consumo vigente');
  perform public.billing_executar_v1('sandbox','billing_processar_webhook_v1',jsonb_build_object('p',jsonb_build_object('id','evt_'||gen_random_uuid(),'event','SUBSCRIPTION_DELETED','subscription',jsonb_build_object('id','sub_'||s,'customer','cus_'||s))));
  perform public.ia_test_pagamento(s,'tardio_'||s,(d+interval '2 months')::date);
  perform public.ia_test_entregar();
  perform public.ia_test_check((select status_local='canceled' from public.billing_subscriptions where id=s),plano||' confirmação tardia mantém cancelamento');
  perform public.ia_test_check((public.ia_ciclo_atual_v1(u)).id=c,plano||' confirmação futura não troca concessão vigente');
 end loop;
 perform public.ia_test_check((select inicio='2026-02-28 00:00 America/Sao_Paulo'::timestamptz and fim='2026-03-31 00:00 America/Sao_Paulo'::timestamptz and alinhado from public.billing_periodo_financeiro_v1('2026-01-31','2026-02-28')),'aniversário 31 retorna ao dia 31 após fevereiro');
 perform public.ia_test_check((select inicio='2028-02-29 00:00 America/Sao_Paulo'::timestamptz and fim='2028-03-31 00:00 America/Sao_Paulo'::timestamptz from public.billing_periodo_financeiro_v1('2028-01-31','2028-02-29')),'aniversário em fevereiro bissexto');
end $homologacao$;

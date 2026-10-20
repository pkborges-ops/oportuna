-- Somente banco isolado/homologacao. Eventos sinteticos, sem API ou dados reais.
-- Funciona em banco de teste dedicado a sandbox OU production. Sempre ROLLBACK.
begin;
do $ambientes$
declare ambiente_atual text:=public.billing_ambiente_v1();
  outro text; rejeitado boolean; u uuid:=gen_random_uuid(); c uuid;
begin
  outro:=case when ambiente_atual='sandbox' then 'production' else 'sandbox' end;
  if not public.billing_verificar_ambiente_v1(ambiente_atual) then raise exception 'Ambiente atual rejeitado'; end if;
  begin
    perform public.billing_executar_v1(outro,'billing_processar_webhook_v1',
      jsonb_build_object('p',jsonb_build_object('id','evt_cruzado','event','PAYMENT_CONFIRMED')));
    raise exception 'Ambiente cruzado aceito';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.billing_webhook_events where gateway_event_id='evt_cruzado') then
    raise exception 'Evento cruzado persistido'; end if;
  begin
    perform public.billing_executar_v1(ambiente_atual,'operacao_arbitraria','{}');
    raise exception 'Operacao arbitraria aceita';
  exception when insufficient_privilege then null; end;
  insert into auth.users(id,email) values(u,u||'@example.invalid');
  begin
    insert into public.billing_customers(usuario_id,ambiente) values(u,outro);
    raise exception 'Registro cruzado aceito';
  exception when insufficient_privilege then null; end;
  c:=(public.billing_executar_v1(ambiente_atual,'billing_reservar_cliente_v1',
    jsonb_build_object('p_usuario',u))->>'id')::uuid;
  if (select ambiente from public.billing_customers where id=c)<>ambiente_atual then
    raise exception 'Registro no ambiente errado'; end if;
  begin
    update public.billing_configuracao set ambiente=outro;
    raise exception 'Ambiente alterado com historico';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.billing_configuracao','SELECT') or
    has_table_privilege('service_role','public.billing_configuracao','UPDATE') or
    has_function_privilege('authenticated','public.billing_verificar_ambiente_v1(text)','EXECUTE') or
    has_function_privilege('authenticated','public.billing_executar_v1(text,text,jsonb)','EXECUTE') then
    raise exception 'Configuracao financeira exposta'; end if;
  set local role service_role;
  if not public.billing_verificar_ambiente_v1(ambiente_atual) then raise exception 'Servico nao validou banco'; end if;
  reset role;
  raise notice 'Ambientes billing: separacao, gateway atomico, auditoria e permissoes OK';
end $ambientes$;
rollback;

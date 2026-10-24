"""Regressões com sessões PostgreSQL reais; sem provedor ou serviço remoto."""
import concurrent.futures
import json
import time

OPPORTUNITY = '20000000-0000-0000-0000-000000000001'
VERSION = 'analise-v2-comercial-p1'


def snapshots_concorrencia(sql):
    def fixture(quota):
        u = sql('select public.ia_test_usuario();')
        sql(f"select public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),'{u}','PRO',{quota},now()-interval '1 day',now()+interval '1 day','snapshots concorrentes');")
        sql('select public.ia_test_entregar();')
        return u

    def reserve(u, h):
        return (f"set local role authenticated; set local request.jwt.claim.sub='{u}'; "
                f"select public.ia_reservar_v1('{u}','{u}','{OPPORTUNITY}',repeat('{h}',64),'{VERSION}',"
                f"'{{\"perfil\":{{\"id\":\"{u}\"}},\"oportunidade\":{{\"revisao\":\"{h}\"}}}}');")

    def transaction(q):
        return sql("begin; set local statement_timeout='8s'; " + q + ' commit;')

    def race(queries):
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
            return list(pool.map(transaction, queries))

    def reserve_pair(u):
        # A cria a primeira versão e mantém o lock; B disputa o mesmo contexto.
        # Espera de lock observada, não baseada somente no tempo de sleep.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(transaction, "set local application_name='snapshots_a'; " + reserve(u, 'a') + ' select pg_sleep(0.8);')
            deadline = time.monotonic() + 5
            while sql("select exists(select 1 from pg_stat_activity where application_name='snapshots_a' and wait_event='PgSleep');") != 't':
                if a.done():
                    raise AssertionError(a.result())
                assert time.monotonic() < deadline, 'A não entrou na barreira'
                time.sleep(0.01)
            b = pool.submit(transaction, "set local application_name='snapshots_b'; " + reserve(u, 'b'))
            blocked = False
            while not a.done() and not b.done():
                if sql("select exists(select 1 from pg_stat_activity where application_name='snapshots_b' and wait_event_type='Lock');") == 't':
                    blocked = True
                    break
                time.sleep(0.01)
            replies = [json.loads(a.result()), json.loads(b.result())]
            assert blocked, 'B não aguardou o lock de A'
            return replies

    def start(u, e):
        return json.loads(transaction(f"set local role service_role; select public.ia_iniciar_v1('{u}','{e}');"))

    def finish(u, e, token, h):
        return (f"set local role service_role; select public.ia_finalizar_v1('{u}','{e}','{token}',"
                f"public.ia_test_resultado() || jsonb_build_object('resumo','Resultado {h}'));")

    def view(u, h, profile=None):
        return json.loads(transaction(f"set local role authenticated; set local request.jwt.claim.sub='{u}'; "
            f"select public.ia_consultar_interface_v1('{profile or u}','{OPPORTUNITY}',repeat('{h}',64),'{VERSION}');"))

    def check_counts(u, expected_exec, expected_results, expected_consumption):
        counts = json.loads(sql(f"select json_build_array((select count(*) from public.ia_execucoes_v1 where usuario_id='{u}'),"
            f"(select count(*) from public.ia_resultados_v1 where usuario_id='{u}'),"
            f"(select count(*) from public.ia_consumos_v1 where usuario_id='{u}'))"))
        assert counts == [expected_exec, expected_results, expected_consumption], counts
        assert sql(f"select not exists(select 1 from public.ia_ciclos_v1 c where usuario_id='{u}' and "
            "(select count(*) from public.ia_consumos_v1 where ciclo_id=c.id) + "
            "(select count(*) from public.ia_execucoes_v1 where ciclo_id=c.id and estado in ('pending','processing','uncertain')) > c.limite);") == 't'

    # Duas solicitações explícitas distintas: duas reservas se há duas unidades.
    u = fixture(2)
    a, b = reserve_pair(u)
    assert a['codigo'] == b['codigo'] == 'RESERVADA', (a, b)
    ea, eb = a['execucao_id'], b['execucao_id']
    assert ea != eb
    assert sql(f"select (select criado_em from public.ia_execucoes_v1 where id='{ea}') < (select criado_em from public.ia_execucoes_v1 where id='{eb}');") == 't'
    tokens = [json.loads(r) for r in race([f"set local role service_role; select public.ia_iniciar_v1('{u}','{e}');" for e in [ea, eb]])]
    assert all(r['codigo'] == 'INICIADA' for r in tokens)
    ta, tb = [r['token'] for r in tokens]
    for h, e in [('a', ea), ('b', eb)]:
        replies = [json.loads(r) for r in race([reserve(u, h), reserve(u, h)])]
        assert all(r == {'codigo': 'EM_ANDAMENTO', 'execucao_id': e} for r in replies), replies
        assert start(u, e)['codigo'] == 'NAO_INICIADA'
    check_counts(u, 2, 0, 0)
    print('PASS snapshots: duas solicitações distintas com saldo 2; repetições/inícios não criam execução adicional')

    # B termina antes de A. Repetições concorrentes de finalize cobram uma vez.
    assert json.loads(transaction(finish(u, eb, tb, 'b')))['codigo'] == 'CONCLUIDA'
    saved_b = sql(f"select to_jsonb(r) from public.ia_resultados_v1 r where execucao_id='{eb}';")
    assert view(u, 'b')['resultado']['id'] == eb
    for e, t, h in [(ea, ta, 'a'), (eb, tb, 'b')]:
        assert all(json.loads(r)['codigo'] == 'CONCLUIDA' for r in race([finish(u, e, t, h)] * 2))
    check_counts(u, 2, 2, 2)
    assert saved_b == sql(f"select to_jsonb(r) from public.ia_resultados_v1 r where execucao_id='{eb}';")
    for h in ['b', 'c']:
        assert view(u, h)['resultado']['id'] == eb, 'A antiga substituiu B mais recente'
    assert view(u, 'a')['resultado']['id'] == ea  # retorno explícito aos dados A reutiliza A
    assert sql(f"select bool_and(r.conteudo->>'resumo'='Resultado ' || (e.snapshot->'oportunidade'->>'revisao')) from public.ia_resultados_v1 r join public.ia_execucoes_v1 e on e.id=r.execucao_id where e.usuario_id='{u}';") == 't'
    print('PASS snapshots: finalização B→A, dois resultados preservados, consumo único e interface mantém B para dados B/novos')

    # Apenas uma unidade: a segunda solicitação fica sem reserva/chamada.
    limited = fixture(1)
    a, b = reserve_pair(limited)
    assert a['codigo'] == 'RESERVADA' and b['codigo'] == 'LIMITE_ATINGIDO', (a, b)
    e = a['execucao_id']; t = start(limited, e)['token']
    assert json.loads(transaction(reserve(limited, 'a')))['codigo'] == 'EM_ANDAMENTO'
    transaction(finish(limited, e, t, 'a'))
    assert json.loads(transaction(reserve(limited, 'b')))['codigo'] == 'LIMITE_ATINGIDO'
    check_counts(limited, 1, 1, 1)
    print('PASS snapshots: saldo 1 permite apenas uma execução e um consumo')

    # Falha conhecida e incerta em A não afetam a execução ativa B.
    for uncertain in [False, True]:
        failed_user = fixture(2)
        a, b = reserve_pair(failed_user)
        ea, eb = a['execucao_id'], b['execucao_id']
        ta, tb = start(failed_user, ea)['token'], start(failed_user, eb)['token']
        state = 'uncertain' if uncertain else 'failed'
        failure = (f"set local role service_role; select public.ia_falhar_v1('{failed_user}','{ea}','{ta}',"
                   f"{str(uncertain).lower()},'FALHA_LOCAL');")
        assert transaction(failure) == state
        assert sql(f"select estado from public.ia_execucoes_v1 where id='{eb}';") == 'processing'
        assert json.loads(transaction(reserve(failed_user, 'b')))['codigo'] == 'EM_ANDAMENTO'
        transaction(finish(failed_user, eb, tb, 'b'))
        assert view(failed_user, 'b')['resultado']['id'] == eb
        assert json.loads(transaction(finish(failed_user, ea, ta, 'a')))['codigo'] == 'NAO_FINALIZADA'
        check_counts(failed_user, 2, 1, 1)
        assert transaction(failure) == state
        check_counts(failed_user, 2, 1, 1)
        print(f'PASS snapshots: A {state} preserva B ativa/concluída sem consumo ou retentativa de A')

    # RLS efetiva e chamadas autenticadas cruzadas, inclusive mesmo hash.
    other = fixture(2)
    assert view(other, 'b')['resultado'] is None
    assert transaction(f"set local role authenticated; set local request.jwt.claim.sub='{other}'; select count(*) from public.ia_resultados_v1 where usuario_id='{u}';") == '0'
    transaction(f"set local role authenticated; set local request.jwt.claim.sub='{other}'; do $$ begin "
        f"perform public.ia_reservar_v1('{u}','{u}','{OPPORTUNITY}',repeat('b',64),'{VERSION}','{{}}'); "
        "raise exception 'Reserva cruzada aceita'; exception when insufficient_privilege then null; end $$;")
    transaction(f"set local role authenticated; set local request.jwt.claim.sub='{other}'; do $$ begin "
        f"perform public.ia_consultar_interface_v1('{u}','{OPPORTUNITY}',repeat('b',64),'{VERSION}'); "
        "raise exception 'Consulta cruzada aceita'; exception when insufficient_privilege then null; end $$;")
    check_counts(other, 0, 0, 0)
    print('PASS snapshots: isolamento por usuário e RLS preservados')

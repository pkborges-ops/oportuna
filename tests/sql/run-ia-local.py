#!/usr/bin/env python3
"""Cria seu próprio PostgreSQL descartável. Nunca aceita URL/credencial remota."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/usr/lib/postgresql/16/bin')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}


def run(args, **kw):
    return subprocess.run([str(a) for a in args], cwd=ROOT, env=ENV, text=True,
                          capture_output=True, check=True, **kw)


with tempfile.TemporaryDirectory(prefix='oportuna-ia-local-') as temp:
    base = Path(temp)
    data, sock = base / 'data', base / 'socket'
    sock.mkdir()
    run([PG / 'initdb', '-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    started = False
    try:
        run([PG / 'pg_ctl', '-D', data, '-l', base / 'postgres.log', '-o',
             f"-k {sock} -p 55439 -c listen_addresses=''", 'start'])
        started = True
        psql = [PG / 'psql', '-X', '-h', sock, '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
        out = run(psql + ['-f', 'tests/sql/ia-bootstrap-local.sql', '-f', 'supabase/analises_ia_execucoes_v1.sql',
                          '-f', 'tests/sql/analises-ia-execucoes.sql',
                          '-f', 'supabase/analises_ia_conteudo_v2.sql', '-f', 'tests/sql/analises-ia-conteudo-v2.sql',
                          '-f', 'supabase/analises_ia_interface_v1.sql', '-f', 'tests/sql/analises-ia-interface.sql'])
        print(out.stderr)
        print("\n".join(line for line in out.stdout.splitlines() if line.startswith("PASS")))

        def sql(query):
            return run(psql + ['-Atq', '-c', query]).stdout.strip()

        def reserve(user, opportunity, h):
            return ("select public.ia_reservar_v1("
                    f"'00000000-0000-0000-0000-{user:012d}',"
                    f"'10000000-0000-0000-0000-{user:012d}',"
                    f"'20000000-0000-0000-0000-{opportunity:012d}',repeat('{h}',64),'v1','{{}}');")

        def race(queries):
            # Transações em sessões reais: pg_sleep mantém o lock enquanto a outra aguarda.
            def transaction(q):
                return sql('begin; set local role service_role; ' + q + ' select pg_sleep(0.3); commit;').splitlines()[0]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(transaction, queries))

        replies = [json.loads(v) for v in race([reserve(6, 1, 'a'), reserve(6, 1, 'a')])]
        assert sorted(v['codigo'] for v in replies) == ['EM_ANDAMENTO', 'RESERVADA'], replies
        print('PASS concorrência real: dois cliques -> uma reserva')
        replies = [json.loads(v) for v in race([reserve(7, 1, 'a'), reserve(7, 2, 'b')])]
        assert sorted(v['codigo'] for v in replies) == ['LIMITE_ATINGIDO', 'RESERVADA'], replies
        print('PASS concorrência real: dois itens -> uma última unidade')
        e = json.loads(sql(reserve(8, 1, 'a')))['execucao_id']
        u = '00000000-0000-0000-0000-000000000008'
        token = json.loads(sql(f"set role service_role; select public.ia_iniciar_v1('{u}','{e}');"))['token']
        payload = json.dumps(dict(score=70, justificativa='J', resumo='R', pontos_atencao=['P']))
        finish = f"select public.ia_finalizar_v1('{u}','{e}','{token}','{payload}');"
        replies = [json.loads(v) for v in race([finish, finish])]
        assert all(v['codigo'] == 'CONCLUIDA' for v in replies), replies
        assert sql(f"select count(*) from public.ia_consumos_v1 where execucao_id='{e}';") == '1'
        assert sql(f"select count(*) from public.ia_resultados_v1 where execucao_id='{e}';") == '1'
        print('PASS concorrência real: duas finalizações -> um resultado e um consumo')
        # Identidade comercial estável evita ciclos duplicados em transações simultâneas.
        u = '00000000-0000-0000-0000-000000000009'
        ref = '30000000-0000-0000-0000-000000000009'
        sql(f"insert into public.assinaturas_usuario(usuario_id,plano,franquia_ia,fim_em,billing_subscription_id) values('{u}','PRO',4,now()+interval '40 days','{ref}');")
        times = sql("select json_build_array(now()-interval '1 day',now()+interval '29 days');")
        start, end = json.loads(times)
        grant = f"select public.ia_autorizar_ciclo_v1('{u}','{ref}','periodo','{start}','{end}');"
        replies = race([grant, grant])
        assert replies[0] == replies[1], replies
        assert sql(f"select count(*) from public.ia_ciclos_v1 where usuario_id='{u}' and plano='PRO';") == '1'
        print('PASS concorrência real: concessão duplicada -> um ciclo')
    except subprocess.CalledProcessError as error:
        print(error.stdout)
        print(error.stderr)
        if (base / 'postgres.log').exists():
            print((base / 'postgres.log').read_text())
        raise
    finally:
        if started:
            run([PG / 'pg_ctl', '-D', data, '-m', 'immediate', 'stop'])

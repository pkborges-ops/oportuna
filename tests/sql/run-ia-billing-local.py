#!/usr/bin/env python3
"""PostgreSQL descartável; contrato financeiro FIXO via arquivos externos.
Não aceita URLs de banco. Não baixa arquivos nem modifica branches.
Uso: python3 tests/sql/run-ia-billing-local.py /tmp/oportuna-finance-183e62e
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/usr/lib/postgresql/16/bin')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
FINANCE = Path(sys.argv[1]).resolve()
# SHA-256 dos bytes publicados no commit 183e62e56c65390111744e8e8ce2249cb5cb7949.
EXPECTED = {'supabase/planos_e_permissoes_v1.sql': '9ec18461ea0d53834daf63f15e013000658ad32459ac6c005fd82ed61fa58884', 'supabase/asaas_assinaturas_v1.sql': '8674514d99c9efaca37f81d164dc9c103c315e5355f45f47334c63375177dd62', 'supabase/billing_concessoes_v1.sql': '01a52a4537648517a95d75e3ce1414991a192953743e7b0a3f3085946217d975'}


def run(args, **kw):
    return subprocess.run([str(a) for a in args], cwd=ROOT, env=ENV, text=True,
                          capture_output=True, check=True, **kw)


def main():
    for name, expected in EXPECTED.items():
        if hashlib.sha256((FINANCE / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Contrato financeiro divergente: ' + name)
    with tempfile.TemporaryDirectory(prefix='oportuna-ia-billing-') as temp:
        base = Path(temp)
        data, sock = base / 'data', base / 'socket'
        sock.mkdir()
        run([PG / 'initdb', '-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'])
        started = False
        try:
            run([PG / 'pg_ctl', '-D', data, '-l', base / 'postgres.log', '-o',
                 f"-k {sock} -p 55440 -c listen_addresses=''", 'start'])
            started = True
            psql = [PG / 'psql', '-X', '-h', sock, '-p', '55440', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']

            def sql(query):
                return run(psql + ['-Atq', '-c', query]).stdout.strip()

            def file(path):
                out = run(psql + ['-f', path])
                print('\n'.join(line for line in (out.stdout + out.stderr).splitlines()
                                if 'PASS' in line or 'verificacoes' in line))

            sql('create database sem_billing')
            psql[psql.index('-d') + 1] = 'sem_billing'
            file(ROOT / 'tests/sql/ia-billing-bootstrap-local.sql')
            file(FINANCE / 'supabase/planos_e_permissoes_v1.sql')
            file(ROOT / 'supabase/analises_ia_execucoes_v1.sql')
            file(ROOT / 'supabase/analises_ia_conteudo_v2.sql')
            missing = subprocess.run([str(a) for a in psql + ['-f', ROOT / 'supabase/analises_ia_billing_adapter_v1.sql']],
                                     cwd=ROOT, env=ENV, text=True, capture_output=True)
            assert missing.returncode != 0 and 'antes do adaptador' in missing.stderr, missing.stderr
            assert sql("select to_regclass('public.ia_concessoes_financeiras_v1') is null;") == 't'
            print('PASS ausência do billing: instalação recusada atomicamente')
            psql[psql.index('-d') + 1] = 'postgres'
            # Roles são globais ao cluster; bootstrap do segundo banco usa o mesmo Auth.
            bootstrap = (ROOT / 'tests/sql/ia-billing-bootstrap-local.sql').read_text()
            bootstrap = '\n'.join(line for line in bootstrap.splitlines() if not line.startswith('create role '))
            bootstrap = bootstrap.replace('\\ir ../../supabase/', '\\ir ' + str(ROOT / 'supabase') + '/')
            (base / 'bootstrap.sql').write_text(bootstrap)
            file(base / 'bootstrap.sql')
            file(FINANCE / 'supabase/planos_e_permissoes_v1.sql')
            file(FINANCE / 'supabase/asaas_assinaturas_v1.sql')
            file(FINANCE / 'supabase/billing_concessoes_v1.sql')
            file(ROOT / 'supabase/analises_ia_execucoes_v1.sql')
            file(ROOT / 'supabase/analises_ia_conteudo_v2.sql')
            file(ROOT / 'tests/sql/ia-billing-legado-local.sql')
            file(ROOT / 'supabase/analises_ia_billing_adapter_v1.sql')
            file(ROOT / 'tests/sql/analises-ia-billing-adapter.sql')
            concurrency(sql, psql)
            worker_outbox(sql)
        except subprocess.CalledProcessError as error:
            print(error.stdout)
            print(error.stderr)
            raise
        finally:
            if started:
                run([PG / 'pg_ctl', '-D', data, '-m', 'immediate', 'stop'])


def concurrency(sql, psql):
    def fixture(quota=2):
        u = sql('select public.ia_test_usuario();')
        g = sql(f"select public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),'{u}','PRO',{quota},now()-interval '1 day',now()+interval '1 day','concorrencia');")
        sql('select public.ia_test_entregar();')
        return u, g

    def reservation(u, h='a'):
        return (f"set local role authenticated; set local request.jwt.claim.sub='{u}'; "
                f"select public.ia_reservar_v1('{u}','{u}','20000000-0000-0000-0000-000000000001',repeat('{h}',64),'analise-v2-comercial-p1','{{}}');")

    def revoke(g):
        return f"select public.billing_revogar_administrativa_v1('sandbox','{g}','Concorrência');"

    def ordered(first, second):
        # Verifica lock WAIT real: primeiro mantém a transação aberta após a operação.
        # Segundo precisa esperar a origem financeira; limite de 8s detecta deadlocks.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(sql, "begin; set local application_name='ia_primeiro'; set local statement_timeout='8s'; "
                            + first + " select pg_sleep(1.2); commit;")
            deadline = time.monotonic() + 5
            while sql("select exists(select 1 from pg_stat_activity where application_name='ia_primeiro' and wait_event='PgSleep');") != 't':
                if a.done():
                    raise AssertionError(a.result())
                if time.monotonic() > deadline:
                    raise AssertionError('primeira transação não ficou pronta')
                time.sleep(0.02)
            b = pool.submit(sql, "begin; set local application_name='ia_segundo'; set local statement_timeout='8s'; " + second + " commit;")
            blocked = False
            while not a.done() and not b.done():
                if sql("select exists(select 1 from pg_stat_activity where application_name='ia_segundo' and wait_event_type='Lock');") == 't':
                    blocked = True
                    break
                time.sleep(0.02)
            ra, rb = a.result(), b.result()
            assert blocked, 'Operação concorrente não aguardou o lock financeiro'
            return ra.strip(), rb.strip()

    u, g = fixture()
    ra, rb = ordered(reservation(u), revoke(g))
    e = json.loads(ra)['execucao_id']
    assert sql(f"select public.ia_iniciar_v1('{u}','{e}')->>'codigo';") == 'CICLO_ENCERRADO'
    print('PASS concorrência: reserva primeiro, revogação aguarda; início posterior bloqueado')

    u, g = fixture()
    ra, rb = ordered(revoke(g), reservation(u))
    assert json.loads(rb)['codigo'] == 'CICLO_NAO_AUTORIZADO'
    print('PASS concorrência: revogação primeiro, reserva aguarda e é negada')

    for revoke_first in [False, True]:
        u, g = fixture()
        e = json.loads(sql('begin; ' + reservation(u) + ' commit;'))['execucao_id']
        t = json.loads(sql(f"set role service_role; select public.ia_iniciar_v1('{u}','{e}');"))['token']
        finish = f"set local role service_role; select public.ia_finalizar_v1('{u}','{e}','{t}',public.ia_test_resultado());"
        ra, rb = ordered(revoke(g), finish) if revoke_first else ordered(finish, revoke(g))
        r = json.loads(rb if revoke_first else ra)
        assert r['codigo'] == ('CICLO_ENCERRADO' if revoke_first else 'CONCLUIDA'), r
        assert sql(f"select count(*) from public.ia_consumos_v1 where execucao_id='{e}';") == ('0' if revoke_first else '1')
        expected = 'uncertain' if revoke_first else 'completed'
        assert sql(f"select estado from public.ia_execucoes_v1 where id='{e}';") == expected
        print('PASS concorrência: ' + ('revogação antes da conclusão -> incerta sem consumo' if revoke_first
              else 'conclusão antes da revogação -> consumo e histórico preservados'))

    u, g = fixture(1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(sql, 'begin; ' + reservation(u,h) + ' commit;') for h in ['a','b']]
        replies = [json.loads(f.result())['codigo'] for f in futures]
    assert sorted(replies) == ['LIMITE_ATINGIDO','RESERVADA'], replies
    print('PASS concorrência: última unidade paga reservada uma única vez')

    # Fronteira temporal real com ciclo ADMIN curto (sem mudar relógio ou termos).
    u = sql('select public.ia_test_usuario();')
    g = sql(f"select public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),'{u}','PRO',2,now()-interval '1 hour',now()+interval '2 seconds','virada');")
    end = sql(f"select fim from public.billing_concessoes where id='{g}';")
    sql(f"select public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),'{u}','PRO',2,'{end}','{end}'::timestamptz+interval '1 day','renovação');")
    sql('select public.ia_test_entregar();')
    e = json.loads(sql('begin; ' + reservation(u) + ' commit;'))['execucao_id']
    t = json.loads(sql(f"select public.ia_iniciar_v1('{u}','{e}');"))['token']
    time.sleep(2.1)
    assert sql(f"select public.ia_finalizar_v1('{u}','{e}','{t}',public.ia_test_resultado())->>'codigo';") in ['CICLO_ENCERRADO','NAO_FINALIZADA']
    assert sql(f"select count(*) from public.ia_consumos_v1 where usuario_id='{u}';") == '0'
    assert json.loads(sql('begin; ' + reservation(u,'b') + ' commit;'))['codigo'] == 'RESERVADA'
    print('PASS virada real: execução antiga não cobra renovação, nova análise reserva novo ciclo')



def worker_outbox(sql):
    # Reutiliza helpers da suíte e RPCs REAIS; nenhum worker financeiro é copiado.
    sql('select public.ia_test_entregar();')

    def grant():
        u = sql('select public.ia_test_usuario();')
        g = sql(f"select public.billing_conceder_administrativa_v1('sandbox',gen_random_uuid(),'{u}','PRO',2,now()-interval '1 day',now()+interval '1 day','worker');")
        return u, g

    def reserve(limit=10):
        return json.loads(sql(f"set role service_role; select public.billing_concessoes_reservar_entregas_v1('sandbox',{limit});"))

    def deliver(item):
        return sql(f"set role service_role; select public.billing_concessoes_entregar_v1('sandbox','{item['entrega_id']}','{item['token']}');")

    u, g = grant()
    item = reserve()[0]
    assert deliver(item) == 'delivered'
    # Resposta original pode ter se perdido após o commit; mesmo token não duplica.
    assert deliver(item) == 'duplicate'
    assert reserve() == []
    assert sql(f"select count(*) from public.ia_concessoes_financeiras_v1 where concessao_id='{g}';") == '1'
    assert sql(f"select count(*) from public.ia_consumos_v1 where usuario_id='{u}';") == '0'
    print('PASS worker: pendente recuperada, ACK perdido/reentrega não duplica ciclo ou consumo')

    grant(); grant()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, [1, 1]))
    ids = [item['entrega_id'] for result in results for item in result]
    assert len(ids) == len(set(ids)) == 2, results
    for result in results:
        assert deliver(result[0]) == 'delivered'
    print('PASS worker: duas execuções concorrentes recebem entregas distintas')

    u, g = grant()
    old = reserve()[0]
    sql(f"update public.billing_concessoes_entregas set lease_ate=now()-interval '1 second' where id='{old['entrega_id']}';")
    new = reserve()[0]
    assert new['entrega_id'] == old['entrega_id'] and new['token'] != old['token']
    assert deliver(old) == 'lease_lost'
    assert deliver(new) == 'delivered'
    print('PASS worker: lease expirado troca token e impede ACK do worker antigo')

    u, g = grant()
    old = reserve()[0]
    sql(f"select public.billing_revogar_administrativa_v1('sandbox','{g}','Antes da recuperação');")
    assert deliver(old) == 'stale'
    new = reserve()[0]
    assert deliver(new) == 'delivered'
    assert sql(f"select estado from public.ia_concessoes_financeiras_v1 where concessao_id='{g}';") == 'REVOKED'
    assert sql(f"select count(*) from public.ia_ciclos_v1 where usuario_id='{u}';") == '0'
    print('PASS worker: revisão antiga é descartada e revogação não cria crédito')

    u, g = grant()
    item = reserve()[0]
    sql('alter function public.ia_receber_concessao_financeira_v1(jsonb) rename to ia_test_hook_temporario;')
    try:
        assert deliver(item) == 'pending'
        assert sql(f"select ultimo_erro from public.billing_concessoes_entregas where id='{item['entrega_id']}';") == 'CONSUMER_NOT_INSTALLED'
        assert sql(f"select count(*) from public.ia_ciclos_v1 where usuario_id='{u}';") == '0'
    finally:
        sql('alter function public.ia_test_hook_temporario(jsonb) rename to ia_receber_concessao_financeira_v1;')
    sql(f"update public.billing_concessoes_entregas set disponivel_em=now() where id='{item['entrega_id']}';")
    assert deliver(reserve()[0]) == 'delivered'
    print('PASS worker: ausência do consumidor mantém pendência e recupera após instalação')


if __name__ == '__main__':
    main()

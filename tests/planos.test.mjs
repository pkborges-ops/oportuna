import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canReceiveAutomaticAlert, getPlanEntitlements, resolveEffectivePlan,
} from '../lib/planos/entitlements.ts';

const now = new Date('2026-09-30T12:00:00Z');
const activeFree = { plano: 'FREE', status: 'active', fim_em: null };
const activePro = { plano: 'PRO', status: 'active', fim_em: null };
const activeBusiness = { plano: 'BUSINESS', status: 'active', fim_em: null };

test('ausência de assinatura, Free e Pro respeitam elegibilidade sem apagar configuração', () => {
  const oldActiveAlert = { ativo: true };
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(null, now), oldActiveAlert.ativo), false);
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(activeFree, now), oldActiveAlert.ativo), false);
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(activePro, now), oldActiveAlert.ativo), true);
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(activeBusiness, now), oldActiveAlert.ativo), true);
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(activePro, now), false), false);
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(activeFree, now), oldActiveAlert.ativo), false);
  assert.equal(canReceiveAutomaticAlert(resolveEffectivePlan(activePro, now), oldActiveAlert.ativo), true);
  assert.equal(oldActiveAlert.ativo, true);
});

test('plano vencido ou cancelado volta a Free e limites são centralizados', () => {
  assert.equal(resolveEffectivePlan({ ...activePro, status: 'canceled' }, now), 'FREE');
  assert.equal(resolveEffectivePlan({ ...activePro, fim_em: '2026-09-29T12:00:00Z' }, now), 'FREE');
  assert.equal(resolveEffectivePlan({ ...activePro, status: 'trial' }, now), 'PRO');
  assert.equal(resolveEffectivePlan(activeBusiness, now), 'BUSINESS');
  assert.equal(resolveEffectivePlan({ ...activeBusiness, status: 'canceled' }, now), 'FREE');
  const free = getPlanEntitlements(undefined);
  const pro = getPlanEntitlements('PRO');
  const business = getPlanEntitlements('BUSINESS');
  assert.deepEqual([free.maxProfiles, free.maxFavorites, free.dailyMatchViews, free.aiAnalysisLimit,
    free.alertsEnabled, free.historyDays, free.maxUsers], [1, 5, 3, 1, false, 30, 1]);
  assert.deepEqual([pro.maxProfiles, pro.maxFavorites, pro.dailyMatchViews,
    pro.alertsEnabled, pro.historyDays, pro.maxUsers], [3, null, null, true, null, 1]);
  assert.deepEqual([business.maxProfiles, business.maxFavorites, business.dailyMatchViews,
    business.alertsEnabled, business.historyDays, business.maxUsers], [null, null, null, true, null, 1]);
});

test('migration preserva ranking V2 e protege acesso direto aos caminhos de score', () => {
  const old = readFileSync('supabase/oportunidades_ciclo_vida_v1.sql', 'utf8');
  const migration = readFileSync('supabase/planos_e_permissoes_v1.sql', 'utf8');
  const ranking = /case when modo in \('recomendadas','maior_aderencia'\) then e\.score end desc nulls last/;
  assert.match(old, ranking);
  assert.match(migration, ranking);
  assert.match(migration, /plano_historico_visivel_v1\(plano_codigo,o\.status/g);
  assert.match(migration, /case when public\.plano_tem_score_v1\(p_perfil_id,o\.id\) then public\.matching_calcular_v1/);
  assert.match(migration, /revoke execute on function public\.listar_oportunidades_paginadas_v1/);
  assert.match(migration, /revoke execute on function public\.matching_calcular_v1/);
  assert.match(migration, /create table public\.analises_ia_consumos/);
  assert.match(migration, /create trigger plano_registrar_consumo_ia_v1 after insert/);
  assert.match(migration, /select count\(\*\) into quantidade from public\.analises_ia_consumos/);
  assert.doesNotMatch(migration, /\b(delete\s+from\s+public\.(?:perfis_empresa|oportunidades_favoritos|analises_oportunidades)|truncate\b|drop\s+table\b)/i);
});

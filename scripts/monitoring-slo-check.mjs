#!/usr/bin/env node
/**
 * Monitoring health gate:
 * - pulls /metrics
 * - checks critical gauges + alert routing env
 */
const base = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const maxSettlementPending = Number(process.env.MONITORING_MAX_SETTLEMENT_PENDING || 0);
const maxDbPoolWaiting = Number(process.env.MONITORING_MAX_DB_POOL_WAITING || 2);
const strictAlertRouting = process.env.MONITORING_REQUIRE_ALERT_ROUTE === '1';

function getMetricValue(text, name) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith(`${name} `) || line.startsWith(`${name}{`)) {
      const idx = line.indexOf(' ');
      if (idx <= 0) continue;
      const raw = line.slice(idx + 1).trim();
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function getAnyMetric(text, names) {
  for (const n of names) {
    const v = getMetricValue(text, n);
    if (v !== null) return { name: n, value: v };
  }
  return { name: names[0], value: null };
}

const res = await fetch(`${base}/metrics`);
if (!res.ok) {
  console.error(`MONITORING_SLO_FAIL metrics_status=${res.status}`);
  process.exit(1);
}
const body = await res.text();

const settlementPendingMetric = getAnyMetric(body, ['exchange_settlement_events_pending', 'settlement_pending_count']);
const settlementCircuitMetric = getAnyMetric(body, ['exchange_settlement_circuit_open', 'settlement_circuit_open']);
const dbPoolWaitingMetric = getAnyMetric(body, ['exchange_db_pool_waiting', 'db_pool_waiting']);
const wsActiveMetric = getAnyMetric(body, ['exchange_ws_connections_active', 'ws_connections_active']);

const checks = [
  {
    name: 'exchange_settlement_events_pending',
    pass: settlementPendingMetric.value !== null && settlementPendingMetric.value <= maxSettlementPending,
    details: `metric=${settlementPendingMetric.name}, value=${settlementPendingMetric.value}, budget<=${maxSettlementPending}`,
  },
  {
    name: 'exchange_settlement_circuit_open',
    pass: settlementCircuitMetric.value !== null && settlementCircuitMetric.value === 0,
    details: `metric=${settlementCircuitMetric.name}, value=${settlementCircuitMetric.value}, expected=0`,
  },
  {
    name: 'exchange_db_pool_waiting',
    pass: dbPoolWaitingMetric.value === null || dbPoolWaitingMetric.value <= maxDbPoolWaiting,
    details: `metric=${dbPoolWaitingMetric.name}, value=${dbPoolWaitingMetric.value}, budget<=${maxDbPoolWaiting}`,
  },
  {
    name: 'exchange_ws_connections_active_present',
    pass: wsActiveMetric.value === null || wsActiveMetric.value >= 0,
    details: `metric=${wsActiveMetric.name}, value=${wsActiveMetric.value}`,
  },
];

const alertRouteOk =
  Boolean((process.env.ALERT_WEBHOOK_URL || '').trim()) ||
  Boolean((process.env.OPS_ALERT_SLACK_URL || '').trim()) ||
  Boolean((process.env.OPS_ALERT_EMAIL_WEBHOOK_URL || '').trim());
checks.push({
  name: 'alert-routing-config',
  pass: strictAlertRouting ? alertRouteOk : true,
  details: alertRouteOk ? 'configured' : 'missing',
});

let ok = true;
for (const c of checks) {
  console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name} ${c.details}`);
  if (!c.pass) ok = false;
}

if (!ok) {
  console.error('MONITORING_SLO_FAIL');
  process.exit(1);
}
console.log('MONITORING_SLO_OK');

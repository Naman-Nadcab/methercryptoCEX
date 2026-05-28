#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

const strict = process.env.COMPLIANCE_STRICT === '1';
const root = process.cwd();
const reportDir = path.join(root, 'docs', 'reports');
const reportPath = path.join(reportDir, 'compliance-signoff.latest.json');

const checks = [];
const warnings = [];
const failures = [];

function addCheck(name, pass, details) {
  checks.push({ name, pass, details });
  if (!pass) failures.push(`${name}: ${details}`);
}

function addWarning(text) {
  warnings.push(text);
}

function has(name) {
  return Boolean((process.env[name] || '').trim());
}

function unwrapSettingText(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s === 'null') return '';
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1);
  return s;
}

async function loadSystemSettingsMap(keys) {
  const out = {};
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const r = await client.query(
        `SELECT key, value::text AS value FROM system_settings WHERE key = ANY($1::text[])`,
        [keys]
      );
      for (const row of r.rows) out[row.key] = unwrapSettingText(row.value);
      return out;
    } catch {
      // docker fallback below
    } finally {
      await client.end().catch(() => {});
    }
  }

  const sql = `SELECT key, value::text FROM system_settings WHERE key IN (${keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')});`;
  const probe = spawnSync(
    'docker',
    ['exec', 'exchange-postgres', 'psql', '-U', 'exchange', '-d', 'exchange', '-At', '-F', '|', '-c', sql],
    { encoding: 'utf8' }
  );
  if (probe.status !== 0) return out;
  for (const line of (probe.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const idx = line.indexOf('|');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1);
    out[k] = unwrapSettingText(v);
  }
  return out;
}

const runtimeSettingKeys = [
  'alert_webhook_url',
  'SANCTIONS_PROVIDER',
  'GEO_BLOCKED_COUNTRIES',
  'AML_HIGH_RISK_COUNTRIES',
  'HIGH_RISK_COUNTRIES',
  'COMPLIANCE_LEGAL_SIGNOFF_ID',
  'COMPLIANCE_FIU_OFFICER',
  'COMPLIANCE_AUDIT_RETENTION_DAYS',
];
const settings = await loadSystemSettingsMap(runtimeSettingKeys);

const thresholds = {
  AML_LARGE_FIAT_INR_THRESHOLD: Number(process.env.AML_LARGE_FIAT_INR_THRESHOLD || 1_000_000),
  AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD: Number(process.env.AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD || 100_000),
  AML_VELOCITY_WITHDRAWAL_COUNT: Number(process.env.AML_VELOCITY_WITHDRAWAL_COUNT || 3),
  AML_VELOCITY_WINDOW_HOURS: Number(process.env.AML_VELOCITY_WINDOW_HOURS || 24),
  WITHDRAWAL_APPROVAL_THRESHOLD: Number(process.env.WITHDRAWAL_APPROVAL_THRESHOLD || 10_000),
};

for (const [k, v] of Object.entries(thresholds)) {
  addCheck(k, Number.isFinite(v) && v > 0, `value=${v}`);
}

const alertConfigured =
  has('ALERT_WEBHOOK_URL') ||
  has('OPS_ALERT_SLACK_URL') ||
  has('OPS_ALERT_EMAIL_WEBHOOK_URL') ||
  Boolean((settings.alert_webhook_url || '').trim());
addCheck('alert-routing-webhook', alertConfigured, 'Require at least one alert webhook target');
if (!alertConfigured) addWarning('No alert webhook configured; SEV notifications will be local-only.');

const sanctionsProvider = (process.env.SANCTIONS_PROVIDER || settings.SANCTIONS_PROVIDER || '').trim();
addCheck('sanctions-provider-configured', sanctionsProvider.length > 0, `provider=${sanctionsProvider || 'none'}`);
if (!sanctionsProvider) addWarning('SANCTIONS_PROVIDER is empty; sanctions checks may be no-op.');

const geoBlocked = (process.env.GEO_BLOCKED_COUNTRIES || settings.GEO_BLOCKED_COUNTRIES || '').trim();
const highRisk = (process.env.AML_HIGH_RISK_COUNTRIES || settings.AML_HIGH_RISK_COUNTRIES || settings.HIGH_RISK_COUNTRIES || '').trim();
addCheck('geo-blocked-countries-configured', geoBlocked.length > 0, `value=${geoBlocked || 'none'}`);
addCheck('aml-high-risk-countries-configured', highRisk.length > 0, `value=${highRisk || 'none'}`);
if (!geoBlocked) addWarning('GEO_BLOCKED_COUNTRIES not configured.');
if (!highRisk) addWarning('AML_HIGH_RISK_COUNTRIES not configured.');

const legalSignoffId = (process.env.COMPLIANCE_LEGAL_SIGNOFF_ID || settings.COMPLIANCE_LEGAL_SIGNOFF_ID || '').trim();
const fiuOfficer = (process.env.COMPLIANCE_FIU_OFFICER || settings.COMPLIANCE_FIU_OFFICER || '').trim();
const retentionDays = Number(process.env.COMPLIANCE_AUDIT_RETENTION_DAYS || settings.COMPLIANCE_AUDIT_RETENTION_DAYS || 0);
addCheck('legal-signoff-id', legalSignoffId.length > 0, `value=${legalSignoffId || 'none'}`);
addCheck('fiu-officer-assigned', fiuOfficer.length > 0, `value=${fiuOfficer || 'none'}`);
addCheck('audit-retention-days', Number.isFinite(retentionDays) && retentionDays >= 365, `value=${retentionDays}`);
if (!legalSignoffId) addWarning('COMPLIANCE_LEGAL_SIGNOFF_ID not configured.');
if (!fiuOfficer) addWarning('COMPLIANCE_FIU_OFFICER not configured.');
if (!Number.isFinite(retentionDays) || retentionDays < 365) {
  addWarning('COMPLIANCE_AUDIT_RETENTION_DAYS must be >= 365 for strict signoff.');
}

const fiu = spawnSync('./node_modules/.bin/tsx', ['apps/backend/scripts/tier1-fiu-readiness-verify.ts'], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});
const fiuOut = `${fiu.stdout || ''}\n${fiu.stderr || ''}`.trim();
const fiuPass = fiu.status === 0;
addCheck('tier1-fiu-readiness-script', fiuPass, fiuPass ? 'pass' : `exit=${fiu.status}`);
if (!fiuPass) addWarning('FIU readiness script failed; inspect report output.');

const manualTasks = [
  'Legal signoff for KYC/AML policy',
  'FIU reporting officer assignment',
  'Audit log retention policy acknowledgement',
];

const pass = strict ? failures.length === 0 : true;
const report = {
  generated_at: new Date().toISOString(),
  strict_mode: strict,
  pass,
  checks,
  warnings,
  manual_tasks_pending: manualTasks,
  fiu_script_output_tail: fiuOut.slice(-4000),
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Compliance signoff report: ${reportPath}`);
for (const c of checks) console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name} - ${c.details}`);
for (const w of warnings) console.log(`[WARN] ${w}`);

if (!pass) {
  console.error('COMPLIANCE_SIGNOFF_FAIL');
  process.exit(1);
}
console.log('COMPLIANCE_SIGNOFF_OK');

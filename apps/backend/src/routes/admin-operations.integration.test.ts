/**
 * Runtime integration checks for admin operations hardening routes.
 *
 * Requires a running API server.
 * Defaults:
 *   ADMIN_BASE_URL=http://127.0.0.1:4000/api/v1/admin
 *   ADMIN_EMAIL=admin@example.com
 *   ADMIN_PASSWORD=admin123
 *
 * Or pass an existing token:
 *   ADMIN_JWT=... npx tsx src/routes/admin-operations.integration.test.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

type JsonBody = Record<string, unknown>;

const base = (process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4000/api/v1/admin').replace(/\/$/, '');
const staticToken = (process.env.ADMIN_JWT ?? process.env.ADMIN_ACCESS_TOKEN ?? '').trim();
const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@example.com').trim();
const adminPassword = (process.env.ADMIN_PASSWORD ?? 'admin123').trim();
const clientUa = (process.env.ADMIN_VERIFY_USER_AGENT ?? 'tier1-admin-ops-verify').trim();

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

async function callApi(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: JsonBody }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': clientUa,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json: JsonBody = {};
  try {
    json = (await res.json()) as JsonBody;
  } catch {
    // keep empty
  }
  return { status: res.status, json };
}

async function resolveAdminToken(): Promise<string> {
  if (staticToken) return staticToken;
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': clientUa,
    },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`admin login failed HTTP ${res.status}: ${txt.slice(0, 300)}`);
  const body = JSON.parse(txt) as { data?: { accessToken?: string } };
  const token = body.data?.accessToken?.trim();
  if (!token) throw new Error('admin login response missing accessToken');
  return token;
}

function errCode(json: JsonBody): string | undefined {
  const e = json.error as { code?: string } | undefined;
  return e?.code;
}

async function run(): Promise<void> {
  let token = '';
  try {
    token = await resolveAdminToken();
  } catch (e) {
    console.log(`SKIP: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(0);
  }

  // 1) jobs health returns authenticated payload
  const health = await callApi(token, 'GET', '/operations/jobs/health');
  if (health.status === 404) {
    console.log('SKIP: /operations/jobs/health not available on target server (restart API with latest backend build)');
    process.exit(0);
  }
  assert(health.status === 200, `Expected 200 on jobs health, got ${health.status}`);
  const jobs = ((health.json.data as { jobs?: unknown[] } | undefined)?.jobs ?? []) as unknown[];
  assert(Array.isArray(jobs), 'Expected jobs array in jobs health response');
  console.log('PASS: jobs health response validated');

  // 2) recovery reason required
  const noReason = await callApi(token, 'POST', '/operations/jobs/recovery', {
    job_id: 'settlement_worker',
    action: 'replay_failed',
  });
  assert(noReason.status === 400, `Expected 400 for missing reason, got ${noReason.status}`);
  assert(errCode(noReason.json) === 'REASON_REQUIRED', `Expected REASON_REQUIRED, got ${errCode(noReason.json)}`);
  console.log('PASS: recovery reason guard enforced');

  // 3) invalid recovery action
  const badRecovery = await callApi(token, 'POST', '/operations/jobs/recovery', {
    job_id: 'settlement_worker',
    action: 'invalid_action',
    reason: 'integration invalid recovery path',
  });
  assert(badRecovery.status === 400, `Expected 400 for invalid recovery action, got ${badRecovery.status}`);
  assert(
    errCode(badRecovery.json) === 'INVALID_RECOVERY_ACTION',
    `Expected INVALID_RECOVERY_ACTION, got ${errCode(badRecovery.json)}`
  );
  console.log('PASS: invalid recovery action rejected');

  // 4) snapshot reason required
  const noSnapshotReason = await callApi(token, 'POST', '/operations/config/snapshot', {
    scope: 'global',
  });
  assert(noSnapshotReason.status === 400, `Expected 400 for missing snapshot reason, got ${noSnapshotReason.status}`);
  assert(
    errCode(noSnapshotReason.json) === 'REASON_REQUIRED',
    `Expected REASON_REQUIRED for snapshot, got ${errCode(noSnapshotReason.json)}`
  );
  console.log('PASS: snapshot reason guard enforced');

  // 5) invalid simulation action
  const badSim = await callApi(token, 'POST', '/operations/simulate', { action: 'unknown_action' });
  assert(badSim.status === 400, `Expected 400 for invalid simulation action, got ${badSim.status}`);
  assert(errCode(badSim.json) === 'INVALID_SIM_ACTION', `Expected INVALID_SIM_ACTION, got ${errCode(badSim.json)}`);
  console.log('PASS: simulation invalid-action contract enforced');

  // 6) step-up required on sensitive hybrid route
  const stepUp = await callApi(token, 'POST', '/external-liquidity/providers/bulk-state', {
    provider_ids: [randomUUID()],
    enabled: false,
    dry_run: true,
    reason: 'integration step-up check',
  });
  assert(stepUp.status === 401, `Expected 401 for missing step-up auth, got ${stepUp.status}`);
  assert(errCode(stepUp.json) === 'STEP_UP_REQUIRED', `Expected STEP_UP_REQUIRED, got ${errCode(stepUp.json)}`);
  console.log('PASS: step-up guard enforced on sensitive hybrid writes');

  // 7) high-risk global action should be queued for dual approval
  const queued = await callApi(token, 'POST', '/control/global-action', {
    action: 'halt_trading',
    reason: `integration dual approval ${Date.now()}`,
    submit_for_approval: true,
  });
  assert(queued.status === 200, `Expected 200 for queued global action, got ${queued.status}`);
  const qData = (queued.json.data as { queued_for_approval?: boolean; approval_request_id?: string } | undefined) ?? {};
  assert(qData.queued_for_approval === true, 'Expected queued_for_approval=true for halt_trading');
  assert(typeof qData.approval_request_id === 'string' && qData.approval_request_id.length > 10, 'Expected approval_request_id');
  const approvalRequestId = String(qData.approval_request_id ?? '');
  console.log('PASS: high-risk global action queued for maker-checker approval');

  // 8) bypass attempt should still queue for approval in strict mode
  const bypassAttempt = await callApi(token, 'POST', '/control/global-action', {
    action: 'disable_withdrawals',
    reason: `integration strict queue ${Date.now()}`,
    submit_for_approval: false,
  });
  assert(bypassAttempt.status === 200, `Expected 200 for bypass attempt request, got ${bypassAttempt.status}`);
  const bData = (bypassAttempt.json.data as { queued_for_approval?: boolean } | undefined) ?? {};
  assert(bData.queued_for_approval === true, 'Expected queued_for_approval=true when bypass is requested');
  console.log('PASS: strict mode blocks maker-checker bypass on high-risk action');

  // 9) approval impact preview + forensics bundle contract
  const preview = await callApi(token, 'GET', `/approval-requests/${encodeURIComponent(approvalRequestId)}/impact-preview`);
  assert(preview.status === 200, `Expected 200 for impact preview, got ${preview.status}`);
  const forensics = await callApi(token, 'GET', `/approval-requests/${encodeURIComponent(approvalRequestId)}/forensics`);
  assert(forensics.status === 200, `Expected 200 for forensics export, got ${forensics.status}`);
  console.log('PASS: approval preview and forensics endpoints validated');

  const retryMissing = await callApi(token, 'POST', `/approval-requests/${encodeURIComponent(approvalRequestId)}/retry-execution`, {
    reason: 'short',
  });
  assert(retryMissing.status === 400, `Expected 400 for short retry reason, got ${retryMissing.status}`);
  assert(errCode(retryMissing.json) === 'REASON_REQUIRED', `Expected REASON_REQUIRED, got ${errCode(retryMissing.json)}`);
  console.log('PASS: retry execution reason guard enforced');

  const breakGlassWithoutSession = await callApi(
    token,
    'POST',
    `/approval-requests/${encodeURIComponent(approvalRequestId)}/break-glass-execute`,
    {
      reason: 'integration break glass execute check',
      ticket_id: 'INC-123',
    }
  );
  assert(breakGlassWithoutSession.status === 403, `Expected 403 for non-break-glass session, got ${breakGlassWithoutSession.status}`);
  console.log('PASS: break-glass execution requires privileged break-glass session');

  // 10) approval policies endpoint contract
  const policyRead = await callApi(token, 'GET', '/operations/approvals/policies');
  assert(policyRead.status === 200, `Expected 200 for policies read, got ${policyRead.status}`);
  const policyRows = (policyRead.json.data as unknown[]) ?? [];
  assert(Array.isArray(policyRows), 'Expected policies array');
  assert(policyRows.length > 0, 'Expected at least one approval policy row');
  console.log('PASS: approval policies read endpoint validated');

  const policyHistory = await callApi(token, 'GET', '/operations/approvals/policies/history?limit=5');
  assert(policyHistory.status === 200, `Expected 200 for policies history read, got ${policyHistory.status}`);
  assert(Array.isArray(policyHistory.json.data as unknown[]), 'Expected policy history array');
  console.log('PASS: approval policies history endpoint validated');

  // 11) approval policies write reason guard
  const policyWriteNoReason = await callApi(token, 'POST', '/operations/approvals/policies', { policies: policyRows });
  assert(policyWriteNoReason.status === 400, `Expected 400 for missing policy reason, got ${policyWriteNoReason.status}`);
  assert(errCode(policyWriteNoReason.json) === 'REASON_REQUIRED', `Expected REASON_REQUIRED, got ${errCode(policyWriteNoReason.json)}`);
  console.log('PASS: approval policies reason guard enforced');
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error('FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
);

/**
 * Smoke: config + ops-alert dedupe + signing remote flag. Run: npm run test:phase3-hardening
 */
import { sendOpsAlert } from '../src/services/ops-alert.service.js';
import { config } from '../src/config/index.js';

function fail(m: string): never {
  console.error('FAIL', m);
  process.exit(1);
}

async function main() {
  if (typeof config.signingService.remoteEnabled !== 'boolean') fail('signingService.remoteEnabled');
  if (typeof config.publicApiRedisRate.ipMax !== 'number') fail('publicApiRedisRate');
  if (typeof config.withdrawalWhitelistRelaxed !== 'boolean') fail('withdrawalWhitelistRelaxed');
  if (typeof config.treasury.tokenReconcileIntervalMs !== 'number') fail('tokenReconcileIntervalMs');
  await sendOpsAlert({
    severity: 'info',
    alertType: 'general',
    title: 'phase3 verify',
    body: 'dedupe smoke',
    dedupeKey: 'phase3-verify-smoke',
  });
  await sendOpsAlert({
    severity: 'info',
    alertType: 'general',
    title: 'phase3 verify',
    body: 'dedupe smoke',
    dedupeKey: 'phase3-verify-smoke',
  });
  console.log('OK phase3-ultra-hardening-verify');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

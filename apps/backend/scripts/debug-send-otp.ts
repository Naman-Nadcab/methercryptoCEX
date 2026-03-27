/**
 * Debug script: reproduce send-otp flow to capture exact error.
 * Run: cd apps/backend && npx tsx scripts/debug-send-otp.ts
 */
import { config } from '../src/config/index.js';
import { db } from '../src/lib/database.js';
import { otpService } from '../src/services/otp.service.js';

const TEST_EMAIL = 'test@example.com';

async function main() {
  console.log('=== send-otp debug ===');
  console.log('ENV:', config.env);
  console.log('');

  try {
    console.log('[1] createOTP...');
    const result = await otpService.createOTP(TEST_EMAIL, 'email');
    console.log('[1] OK - otp:', result.otp, 'expiresAt:', result.expiresAt);
  } catch (err) {
    console.error('[1] FAILED createOTP:');
    console.error('  message:', err instanceof Error ? err.message : String(err));
    console.error('  stack:', err instanceof Error ? err.stack : 'N/A');
    process.exit(1);
  }

  try {
    console.log('[2] sendEmailOTP...');
    const sent = await otpService.sendEmailOTP(TEST_EMAIL, '123456');
    console.log('[2] OK - sent:', sent);
  } catch (err) {
    console.error('[2] FAILED sendEmailOTP:');
    console.error('  message:', err instanceof Error ? err.message : String(err));
    console.error('  stack:', err instanceof Error ? err.stack : 'N/A');
    process.exit(1);
  }

  try {
    console.log('[3] user lookup...');
    const r = await db.query(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [TEST_EMAIL]
    );
    console.log('[3] OK - rows:', r.rows.length);
  } catch (err) {
    console.error('[3] FAILED user lookup:');
    console.error('  message:', err instanceof Error ? err.message : String(err));
    console.error('  stack:', err instanceof Error ? err.stack : 'N/A');
    process.exit(1);
  }

  console.log('');
  console.log('=== All steps OK ===');
  process.exit(0);
}

main();

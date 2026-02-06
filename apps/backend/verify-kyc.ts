/**
 * Internal testing: Approve KYC for test users so wallet generation,
 * deposit, withdrawal and transfer can be tested.
 *
 * Usage:
 *   npx tsx verify-kyc.ts                    # Approve both test users
 *   npx tsx verify-kyc.ts dev@byom.de        # Approve only this email
 *   npx tsx verify-kyc.ts nmnsingh02@gmail.com
 */

import { db } from './src/lib/database.js';

const TEST_EMAILS = ['nmnsingh02@gmail.com', 'dev@byom.de'];

async function approveKycForUser(email: string): Promise<boolean> {
  const userResult = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  if (userResult.rows.length === 0) {
    console.log('⚠️  User not found:', email);
    return false;
  }

  const userId = userResult.rows[0].id;

  const kycCheck = await db.query<{ id: string; status: string; kyc_level: number }>(
    `SELECT id, status, kyc_level FROM kyc_applications WHERE user_id = $1`,
    [userId]
  );

  const alreadyApproved = await db.query(
    `SELECT 1 FROM kyc_applications WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
    [userId]
  );

  if (alreadyApproved.rows.length > 0) {
    console.log('✅', email, '— KYC already approved');
    return true;
  }

  if (kycCheck.rows.length > 0) {
    await db.query(
      `UPDATE kyc_applications SET status = 'approved', kyc_level = 1, reviewed_at = COALESCE(reviewed_at, NOW()) WHERE user_id = $1`,
      [userId]
    );
    console.log('✅', email, '— KYC updated to approved');
  } else {
    await db.query(
      `INSERT INTO kyc_applications (user_id, status, kyc_level, submitted_at, reviewed_at) VALUES ($1, 'approved', 1, NOW(), NOW())`,
      [userId]
    );
    console.log('✅', email, '— KYC inserted as approved');
  }

  return true;
}

async function main() {
  const emails = process.argv.slice(2).length > 0 ? process.argv.slice(2) : TEST_EMAILS;

  console.log('Approving KYC for internal testing:', emails.join(', '));

  try {
    for (const email of emails) {
      await approveKycForUser(email.trim());
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();

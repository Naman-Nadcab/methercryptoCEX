import { db } from './src/lib/database.js';

async function verifyKyc() {
  const email = 'nmnsingh02@gmail.com';
  
  try {
    // Get user ID
    const userResult = await db.query(`SELECT id, email FROM users WHERE email = $1`, [email]);
    
    if (userResult.rows.length === 0) {
      console.log('User not found:', email);
      process.exit(1);
    }
    
    const userId = userResult.rows[0].id;
    console.log('Found user:', userId, email);
    
    // Check if KYC application exists
    const kycCheck = await db.query(`SELECT id, status, kyc_level FROM kyc_applications WHERE user_id = $1`, [userId]);
    console.log('Current KYC records:', kycCheck.rows);
    
    // Check with the EXACT query the backend uses
    const backendQuery = await db.query(`
      SELECT status FROM kyc_applications 
      WHERE user_id = $1 AND (status = 'approved' OR status = 'verified')
      LIMIT 1
    `, [userId]);
    console.log('Backend query result (should have 1 row):', backendQuery.rows);
    
    if (backendQuery.rows.length === 0) {
      console.log('\n❌ Backend query returns 0 rows - KYC will be rejected!');
      console.log('Updating KYC to approved...');
      
      if (kycCheck.rows.length > 0) {
        await db.query(`UPDATE kyc_applications SET status = 'approved', kyc_level = 1 WHERE user_id = $1`, [userId]);
      } else {
        await db.query(`INSERT INTO kyc_applications (user_id, status, kyc_level, submitted_at) VALUES ($1, 'approved', 1, NOW())`, [userId]);
      }
      
      // Verify again
      const recheck = await db.query(`
        SELECT status FROM kyc_applications 
        WHERE user_id = $1 AND (status = 'approved' OR status = 'verified')
        LIMIT 1
      `, [userId]);
      console.log('After update - Backend query result:', recheck.rows);
    } else {
      console.log('\n✅ KYC is already approved - backend should allow deposits');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

verifyKyc();

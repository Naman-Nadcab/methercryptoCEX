import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import * as nodeCrypto from 'crypto';
import { pipeline } from 'stream/promises';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

const KYC_UPLOAD_DIR = process.env.KYC_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'kyc');
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

function mapFieldToDocType(field: string, documentType: string): string | null {
  if (field === 'selfie') return 'selfie';
  if (field === 'frontImage') {
    if (documentType === 'aadhaar') return 'aadhaar_front';
    if (documentType === 'pan') return 'pan';
    return 'address_proof';
  }
  if (field === 'backImage' && documentType === 'aadhaar') return 'aadhaar_back';
  return null;
}

interface InitiateKycBody {
  country: string;
  documentType: string;
  provider?: string;
  consent?: {
    aadhaar?: boolean;
    drivingLicense?: boolean;
    pan?: boolean;
  };
}

export default async function kycRoutes(app: FastifyInstance) {
  // Get KYC status
  app.get('/status', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      const result = await db.query(`
        SELECT id, kyc_level, status, submitted_at, reviewed_at, rejection_reason
        FROM kyc_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]);

      if (result.rows.length === 0) {
        return {
          success: true,
          data: {
            status: 'not_submitted',
            kycLevel: 0,
            verified: false,
          }
        };
      }

      const kyc = result.rows[0]!;
      const isVerified = kyc.status === 'approved' || kyc.status === 'verified';

      return {
        success: true,
        data: {
          id: kyc.id,
          status: kyc.status,
          kycLevel: kyc.kyc_level,
          verified: isVerified,
          submittedAt: kyc.submitted_at,
          reviewedAt: kyc.reviewed_at,
          rejectionReason: kyc.rejection_reason,
        }
      };
    } catch (error) {
      logger.error('Failed to get KYC status', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get KYC status' }
      });
    }
  });

  // Initiate KYC verification
  app.post<{ Body: InitiateKycBody }>('/initiate', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { country, documentType, provider, consent } = request.body;

      // Check if user already has a pending or approved KYC
      const existingKyc = await db.query(`
        SELECT id, status FROM kyc_applications
        WHERE user_id = $1 AND status IN ('pending', 'approved', 'verified', 'processing')
        LIMIT 1
      `, [userId]);

      if (existingKyc.rows.length > 0) {
        const existing = existingKyc.rows[0]!;
        if (existing.status === 'approved' || existing.status === 'verified') {
          return reply.status(400).send({
            success: false,
            error: { code: 'ALREADY_VERIFIED', message: 'KYC already verified' }
          });
        }
        if (existing.status === 'pending' || existing.status === 'processing') {
          return reply.status(400).send({
            success: false,
            error: { code: 'ALREADY_PENDING', message: 'KYC verification already in progress' }
          });
        }
      }

      // For DigiLocker (India), auto-approve ONLY when explicitly enabled (dev/demo). Default false for production.
      if (provider === 'digilocker' && country === 'IN' && config.kyc.digilockerDemoAutoApprove) {
        // Create approved KYC record
        const result = await db.query(`
          INSERT INTO kyc_applications (
            user_id, kyc_level, status, country, document_type,
            third_party_provider, submitted_at, reviewed_at
          )
          VALUES ($1, 1, 'approved', $2, $3, $4, NOW(), NOW())
          RETURNING id
        `, [userId, country, documentType, provider]);

        const row = result.rows[0];
        if (!row) throw new Error('Invariant violation: row missing');
        return {
          success: true,
          data: {
            id: row.id,
            status: 'approved',
            message: 'Identity verification successful via DigiLocker'
          }
        };
      }

      // Create pending KYC record for manual verification
      const result = await db.query(`
        INSERT INTO kyc_applications (
          user_id, kyc_level, status, country, document_type,
          submitted_at
        )
        VALUES ($1, 1, 'pending', $2, $3, NOW())
        RETURNING id
      `, [userId, country, documentType]);

      const row = result.rows[0];
      if (!row) throw new Error('Invariant violation: row missing');
      return {
        success: true,
        data: {
          id: row.id,
          status: 'pending',
          message: 'KYC verification initiated. Please upload your documents.'
        }
      };
    } catch (error) {
      logger.error('Failed to initiate KYC', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to initiate KYC verification' }
      });
    }
  });

  // Upload KYC documents — persists to storage and kyc_documents table
  app.post('/upload-document', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      let documentType = 'passport';

      const recs = await db.query<{ id: string }>(
        `SELECT id FROM kyc_records WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (recs.rows.length === 0) {
        const ins = await db.query<{ id: string }>(
          `INSERT INTO kyc_records (user_id, status, level) VALUES ($1, 'pending', 1) RETURNING id`,
          [userId]
        );
        recs.rows = ins.rows;
      }
      const kycRecordId = recs.rows[0]?.id;
      if (!kycRecordId) {
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to get KYC record' }
        });
      }

      const userDir = path.join(KYC_UPLOAD_DIR, userId);
      fs.mkdirSync(userDir, { recursive: true });

      const saved: { field: string; path: string }[] = [];
      let part = await request.file();

      while (part) {
        if (part.fieldname === 'documentType') {
          const chunks: Buffer[] = [];
          for await (const c of part.file) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
          documentType = Buffer.concat(chunks).toString('utf8').trim() || documentType;
          part = await request.file();
          continue;
        }
        const field = part.fieldname;
        const docType = mapFieldToDocType(field, documentType);
        if (docType && part.mimetype && ALLOWED_MIMES.includes(part.mimetype)) {
          const ext = part.mimetype === 'image/png' ? '.png' : part.mimetype === 'image/webp' ? '.webp' : '.jpg';
          const docId = nodeCrypto.randomUUID();
          const fileName = `${docId}${ext}`;
          const filePath = path.join(userDir, fileName);
          await pipeline(part.file, fs.createWriteStream(filePath));
          const buf = fs.readFileSync(filePath);
          const fileHash = nodeCrypto.createHash('sha256').update(buf).digest('hex');

          await db.query(
            `INSERT INTO kyc_documents (kyc_record_id, type, file_url, file_hash, verified)
             SELECT $1, $2, $3, $4, FALSE
             WHERE EXISTS (SELECT 1 FROM kyc_records WHERE id = $1)`,
            [kycRecordId, docType, filePath, fileHash]
          );
          saved.push({ field, path: filePath });
        }
        part = await request.file();
      }

      return {
        success: true,
        data: {
          message: 'Document uploaded successfully',
          saved: saved.length,
        }
      };
    } catch (error) {
      logger.error('Failed to upload document', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to upload document' }
      });
    }
  });

  // Admin: Review KYC application
  app.post<{
    Params: { applicationId: string };
    Body: { action: 'approve' | 'reject'; notes?: string; rejectionReason?: string };
  }>('/admin/review/:applicationId', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const adminId = request.user!.id;
      const { applicationId } = request.params;
      const { action, notes, rejectionReason } = request.body;

      // Verify admin role (simplified check)
      const adminCheck = await db.query(
        `SELECT role FROM users WHERE id = $1`,
        [adminId]
      );

      if (!adminCheck.rows[0] || !['admin', 'super_admin'].includes(adminCheck.rows[0].role)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Admin access required' }
        });
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      await db.query(`
        UPDATE kyc_applications
        SET status = $1, reviewed_at = NOW(), reviewed_by = $2,
            reviewer_notes = $3, rejection_reason = $4, updated_at = NOW()
        WHERE id = $5
      `, [newStatus, adminId, notes, rejectionReason, applicationId]);

      return {
        success: true,
        data: {
          status: newStatus,
          message: `KYC application ${newStatus}`
        }
      };
    } catch (error) {
      logger.error('Failed to review KYC', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to review KYC application' }
      });
    }
  });
}

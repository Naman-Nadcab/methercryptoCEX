import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';

// Admin authentication middleware
async function verifyAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    }

    const decoded = (request.server as any).jwt.verify<{
      id: string;
      adminId: string;
      role: string;
      sessionId: string;
    }>(token);

    // Check if it's an admin token
    if (!decoded.adminId) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }

    // Verify session in Redis
    const session = await redis.getJson<{ isActive: boolean }>(`admin:session:${decoded.sessionId}`);
    if (!session || !session.isActive) {
      return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
    }

    (request as any).admin = decoded;
  } catch (error) {
    return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
  }
}

export default async function uploadRoutes(app: FastifyInstance) {
  // Register multipart support
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
      files: 1, // Only 1 file at a time
    },
  });

  // Frontend public folder path (relative to backend)
  const FRONTEND_PUBLIC = path.resolve(process.cwd(), '../frontend/public');

  // Allowed file types
  const ALLOWED_TYPES = ['image/png', 'image/svg+xml'];
  const ALLOWED_EXTENSIONS = ['.png', '.svg'];

  // Upload logo for blockchain
  app.post('/logo/blockchain/:blockchainId', {
    preHandler: verifyAdmin,
  }, async (request: FastifyRequest<{ Params: { blockchainId: string } }>, reply: FastifyReply) => {
    try {
      const { blockchainId } = request.params;

      // Verify blockchain exists
      const blockchain = await db.query(
        'SELECT id, chain_symbol FROM blockchains WHERE id = $1',
        [blockchainId]
      );
      
      if (blockchain.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Blockchain not found' }
        });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' }
        });
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG and SVG files are allowed' }
        });
      }

      // Get file extension
      const ext = data.mimetype === 'image/png' ? '.png' : '.svg';
      const chainSymbol = blockchain.rows[0].chain_symbol.toLowerCase();
      const filename = `${chainSymbol}${ext}`;

      // Create directory if not exists
      const uploadDir = path.join(FRONTEND_PUBLIC, 'assets/upload/blockchain-logo');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Save file
      const filepath = path.join(uploadDir, filename);
      await pipeline(data.file, fs.createWriteStream(filepath));

      // Update database with logo URL
      const logoUrl = `/assets/upload/blockchain-logo/${filename}`;
      await db.query(
        'UPDATE blockchains SET logo_url = $1 WHERE id = $2',
        [logoUrl, blockchainId]
      );

      return reply.send({
        success: true,
        data: {
          logo_url: logoUrl,
          filename,
        }
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      return reply.status(500).send({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: error.message || 'Failed to upload file' }
      });
    }
  });

  // Upload logo for currency/token
  app.post('/logo/currency/:currencyId', {
    preHandler: verifyAdmin,
  }, async (request: FastifyRequest<{ Params: { currencyId: string } }>, reply: FastifyReply) => {
    try {
      const { currencyId } = request.params;

      // Verify currency exists
      const currency = await db.query(
        'SELECT id, symbol FROM currencies WHERE id = $1',
        [currencyId]
      );
      
      if (currency.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Currency not found' }
        });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' }
        });
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG and SVG files are allowed' }
        });
      }

      // Get file extension
      const ext = data.mimetype === 'image/png' ? '.png' : '.svg';
      const symbol = currency.rows[0].symbol.toLowerCase();
      const filename = `${symbol}${ext}`;

      // Create directory if not exists
      const uploadDir = path.join(FRONTEND_PUBLIC, 'assets/upload/currency-logo');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Save file
      const filepath = path.join(uploadDir, filename);
      await pipeline(data.file, fs.createWriteStream(filepath));

      // Update database with logo URL
      const logoUrl = `/assets/upload/currency-logo/${filename}`;
      await db.query(
        'UPDATE currencies SET logo_url = $1 WHERE id = $2',
        [logoUrl, currencyId]
      );

      return reply.send({
        success: true,
        data: {
          logo_url: logoUrl,
          filename,
        }
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      return reply.status(500).send({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: error.message || 'Failed to upload file' }
      });
    }
  });

  // Generic upload endpoint - for new items (before ID exists)
  app.post('/logo/:type', {
    preHandler: verifyAdmin,
  }, async (request: FastifyRequest<{ 
    Params: { type: 'blockchain' | 'currency' },
    Querystring: { symbol: string }
  }>, reply: FastifyReply) => {
    try {
      const { type } = request.params;
      const { symbol } = request.query;

      if (!symbol) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_SYMBOL', message: 'Symbol is required' }
        });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' }
        });
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG and SVG files are allowed' }
        });
      }

      // Get file extension and filename
      const ext = data.mimetype === 'image/png' ? '.png' : '.svg';
      const cleanSymbol = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
      const filename = `${cleanSymbol}${ext}`;

      // Determine upload directory based on type
      const subDir = type === 'blockchain' ? 'blockchain-logo' : 'currency-logo';
      const uploadDir = path.join(FRONTEND_PUBLIC, `assets/upload/${subDir}`);
      
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Save file
      const filepath = path.join(uploadDir, filename);
      await pipeline(data.file, fs.createWriteStream(filepath));

      const logoUrl = `/assets/upload/${subDir}/${filename}`;

      return reply.send({
        success: true,
        data: {
          logo_url: logoUrl,
          filename,
        }
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      return reply.status(500).send({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: error.message || 'Failed to upload file' }
      });
    }
  });
}

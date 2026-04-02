import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import { config } from '../config/index.js';

export const P2P_PAYMENT_PROOF_MIMES = ['image/png', 'image/jpeg', 'image/jpg'] as const;

const SECURE_PREFIX = 'secure:';

function extForMime(m: string): string {
  if (m === 'image/png') return '.png';
  return '.jpg';
}

/** PNG / JPEG magic bytes (first bytes). */
export function looksLikeAllowedImage(buffer: Buffer, claimedMime: string): boolean {
  if (buffer.length < 8) return false;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (claimedMime === 'image/png') return isPng;
  if (claimedMime === 'image/jpeg' || claimedMime === 'image/jpg') return isJpeg;
  return isPng || isJpeg;
}

export function getSecureP2pProofDir(): string {
  return path.resolve(process.cwd(), 'data', 'p2p-payment-proofs');
}

export function isSecureProofRef(proofUrl: string | null | undefined): boolean {
  return typeof proofUrl === 'string' && proofUrl.startsWith(SECURE_PREFIX);
}

/** Filename only (no path traversal). */
export function secureProofFilenameFromRef(proofUrl: string): string | null {
  if (!proofUrl.startsWith(SECURE_PREFIX)) return null;
  const name = proofUrl.slice(SECURE_PREFIX.length).replace(/^\/+/, '');
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  return name;
}

export function resolveSecureProofAbsolutePath(filename: string): string {
  return path.join(getSecureP2pProofDir(), filename);
}

/**
 * Read multipart file into buffer (bounded), validate type + magic, write to storage.
 * `secure` (default in config): private data dir, DB stores `secure:<filename>`.
 * `public`: legacy web-accessible path under frontend public.
 */
export async function saveP2pPaymentProofFromMultipart(
  orderId: string,
  file: MultipartFile,
  maxBytes: number
): Promise<{ proofUrl: string; byteLength: number }> {
  if (!P2P_PAYMENT_PROOF_MIMES.includes(file.mimetype as (typeof P2P_PAYMENT_PROOF_MIMES)[number])) {
    throw new Error('INVALID_IMAGE_TYPE');
  }
  const buf = await file.toBuffer();
  if (buf.length > maxBytes) {
    throw new Error('FILE_TOO_LARGE');
  }
  if (buf.length === 0) {
    throw new Error('EMPTY_FILE');
  }
  if (!looksLikeAllowedImage(buf, file.mimetype)) {
    throw new Error('INVALID_IMAGE_CONTENT');
  }
  const ext = extForMime(file.mimetype);
  const filename = `${orderId}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const mode = config.p2p.paymentProofStorage;

  if (mode === 'secure') {
    const uploadDir = getSecureP2pProofDir();
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filepath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filepath, buf);
    return { proofUrl: `${SECURE_PREFIX}${filename}`, byteLength: buf.length };
  }

  const uploadDir = path.resolve(process.cwd(), '../frontend/public/assets/upload/p2p-proofs');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const filepath = path.join(uploadDir, filename);
  await fs.promises.writeFile(filepath, buf);
  return { proofUrl: `/assets/upload/p2p-proofs/${filename}`, byteLength: buf.length };
}

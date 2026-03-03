/**
 * HMAC API authentication for signed API requests.
 * When X-SIGNATURE and X-TIMESTAMP are present, verify HMAC-SHA256 signature
 * using api_secret. Uses X-MBX-APIKEY or X-API-Key for the API key.
 */
import * as crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const RECV_WINDOW_MS = 60000; // 60 seconds

/**
 * Build the payload to sign for HMAC verification.
 * Payload = timestamp + method + path + (queryString for GET, body for POST/PUT/DELETE).
 */
export function buildHmacPayload(request: FastifyRequest): string {
  const ts = (request.headers['x-timestamp'] as string) || '';
  const method = (request.method || 'GET').toUpperCase();
  const url = request.url || '';
  const queryStart = url.indexOf('?');
  const path = queryStart >= 0 ? url.slice(0, queryStart) : url;
  const queryString = queryStart >= 0 ? url.slice(queryStart + 1) : '';

  if (method === 'GET') {
    return `${ts}${method}${path}${queryString}`;
  }
  const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
  return `${ts}${method}${path}${body}`;
}

/**
 * Verify HMAC-SHA256 signature. Returns true if valid.
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  apiSecret: string
): boolean {
  const expected = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Check if request has HMAC auth headers.
 */
export function hasHmacHeaders(request: FastifyRequest): boolean {
  const sig = (request.headers['x-signature'] as string)?.trim();
  const ts = (request.headers['x-timestamp'] as string)?.trim();
  return !!(sig && ts);
}

/**
 * Validate timestamp is within recvWindow.
 */
export function isTimestampValid(timestampStr: string): boolean {
  const ts = parseInt(timestampStr, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  return Math.abs(now - ts) <= RECV_WINDOW_MS;
}

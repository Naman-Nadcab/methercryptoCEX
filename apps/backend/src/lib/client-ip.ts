/**
 * Client IP extraction from Fastify request.
 * Respects proxy headers: X-Forwarded-For, X-Real-IP, CF-Connecting-IP (Cloudflare).
 * With trustProxy, Fastify sets request.ip from the leftmost forwarded value; we still
 * normalize and optionally honor CF-Connecting-IP for accuracy behind Cloudflare.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Get the client IP from the request.
 * Order: CF-Connecting-IP (if present) > X-Real-IP > first entry of X-Forwarded-For > request.ip.
 * The first non-private, non-internal address in X-Forwarded-For can be used as "client";
 * when behind a single trusted proxy, the leftmost is typically the client.
 */
export function getClientIp(request: FastifyRequest): string {
  const headers = request.headers;

  // Cloudflare sends the connecting client IP
  const cfIp = headers['cf-connecting-ip'];
  if (typeof cfIp === 'string') {
    const t = cfIp.trim();
    if (t) return t;
  }

  // Single proxy often sets X-Real-IP
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string') {
    const t = realIp.trim();
    if (t) return t;
  }

  // X-Forwarded-For: "client, proxy1, proxy2" — leftmost is original client when trustProxy is used
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    const first = typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? (forwarded[0] as string)?.trim()
        : null;
    if (first) return first;
  }

  // Fastify's request.ip (set when trustProxy is true)
  const ip = request.ip;
  if (ip && typeof ip === 'string') {
    const t = ip.trim();
    if (t) return t;
  }

  return '0.0.0.0';
}

/**
 * Get country code from request when provided by edge (e.g. Cloudflare CF-IPCountry).
 * Returns uppercase 2-letter ISO code or null.
 */
export function getCountryFromRequest(request: FastifyRequest): string | null {
  const cfCountry = request.headers['cf-ipcountry'];
  if (typeof cfCountry === 'string') {
    const c = cfCountry.trim().toUpperCase();
    if (c.length === 2 && c !== 'XX') return c;
  }
  return null;
}

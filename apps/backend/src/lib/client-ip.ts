/**
 * Client IP extraction. When TRUSTED_PROXY_IPS is set, forwarded headers are used only if the
 * immediate TCP peer matches a trusted proxy; otherwise socket.remoteAddress is used (anti-spoof).
 */

import type { FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'http';
import { config } from '../config/index.js';
import { isTrustedProxyPeer } from './ip-trust.js';

function normalizeIp(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('::ffff:') && t.includes('.')) return t.slice(7);
  return t;
}

/**
 * Get the client IP from the request.
 * trustedProxyIps empty: legacy behavior (CF / X-Real-IP / X-Forwarded-For / request.ip).
 * trustedProxyIps non-empty: forwarded headers only if socket peer is trusted; else socket IP.
 */
export function getClientIp(request: FastifyRequest): string {
  const rules = config.security.trustedProxyIps;
  const socketIp = normalizeIp(request.socket?.remoteAddress ?? '') || '';

  const trustForwarded = rules.length === 0 || isTrustedProxyPeer(request.socket?.remoteAddress, rules);

  if (trustForwarded) {
    const headers = request.headers;
    const cfIp = headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') {
      const t = cfIp.trim();
      if (t) return t;
    }
    const realIp = headers['x-real-ip'];
    if (typeof realIp === 'string') {
      const t = realIp.trim();
      if (t) return t;
    }
    const forwarded = headers['x-forwarded-for'];
    if (forwarded) {
      const first =
        typeof forwarded === 'string'
          ? forwarded.split(',')[0]?.trim()
          : Array.isArray(forwarded)
            ? (forwarded[0] as string)?.trim()
            : null;
      if (first) return first;
    }
    const ip = request.ip;
    if (ip && typeof ip === 'string') {
      const t = ip.trim();
      if (t) return t;
    }
  }

  if (socketIp) return socketIp;
  return '0.0.0.0';
}

/**
 * Same rules as {@link getClientIp} for raw Node upgrade requests (e.g. WebSocket).
 */
export function getClientIpFromIncomingMessage(request: IncomingMessage): string {
  const rules = config.security.trustedProxyIps;
  const socketRa = request.socket?.remoteAddress ?? '';
  const socketIp = normalizeIp(socketRa) || '';

  const trustForwarded = rules.length === 0 || isTrustedProxyPeer(request.socket?.remoteAddress, rules);

  if (trustForwarded) {
    const headers = request.headers;
    const cfIp = headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') {
      const t = cfIp.trim();
      if (t) return t;
    }
    const realIp = headers['x-real-ip'];
    if (typeof realIp === 'string') {
      const t = realIp.trim();
      if (t) return t;
    }
    const forwarded = headers['x-forwarded-for'];
    if (forwarded) {
      const first =
        typeof forwarded === 'string'
          ? forwarded.split(',')[0]?.trim()
          : Array.isArray(forwarded)
            ? (forwarded[0] as string)?.trim()
            : null;
      if (first) return first;
    }
  }

  if (socketIp) return socketIp;
  return '0.0.0.0';
}

export function getCountryFromRequest(request: FastifyRequest): string | null {
  const cfCountry = request.headers['cf-ipcountry'];
  if (typeof cfCountry === 'string') {
    const c = cfCountry.trim().toUpperCase();
    if (c.length === 2 && c !== 'XX') return c;
  }
  return null;
}

import type { ParsedQs } from 'qs';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config/index.js';
import { logger, securityLog } from '../lib/logger.js';

/**
 * Configure CORS
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (config.security.corsOrigins.includes(origin) || config.security.corsOrigins.includes('*')) {
      callback(null, true);
    } else {
      securityLog('cors_blocked', 'low', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-CSRF-Token',
    'X-Client-Version',
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  maxAge: 86400, // 24 hours
});

/**
 * Configure Helmet for security headers
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...config.security.corsOrigins],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/**
 * Request sanitization middleware
 */
export function sanitizeRequest(req: Request, res: Response, next: NextFunction): void {
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query as Record<string, unknown>) as ParsedQs;
  }

  // Sanitize body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize params
  if (req.params) {
    req.params = sanitizeObject(req.params) as Record<string, string>;
  }

  next();
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === 'string' ? sanitizeString(item) : item
      );
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * SQL injection protection (additional layer)
 */
export function sqlInjectionProtection(req: Request, res: Response, next: NextFunction): void {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i,
    /(--)|(\/\*)|(\*\/)/,
    /(;.*--)/,
    /(\bOR\b.*=)/i,
    /(\bAND\b.*=)/i,
  ];

  const checkValue = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some((pattern) => pattern.test(value));
    }
    if (Array.isArray(value)) {
      return value.some(checkValue);
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some(checkValue);
    }
    return false;
  };

  const isSuspicious =
    checkValue(req.query) || checkValue(req.body) || checkValue(req.params);

  if (isSuspicious) {
    securityLog('sql_injection_attempt', 'high', {
      ip: req.ip,
      path: req.path,
      query: req.query,
      body: typeof req.body === 'object' ? '[REDACTED]' : undefined,
    });

    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Request contains invalid characters',
      },
    });
    return;
  }

  next();
}

/**
 * XSS protection middleware
 */
export function xssProtection(req: Request, res: Response, next: NextFunction): void {
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<img[^>]+src[^>]+onerror/gi,
  ];

  const checkValue = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return xssPatterns.some((pattern) => pattern.test(value));
    }
    if (Array.isArray(value)) {
      return value.some(checkValue);
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some(checkValue);
    }
    return false;
  };

  const hasXss = checkValue(req.query) || checkValue(req.body);

  if (hasXss) {
    securityLog('xss_attempt', 'high', {
      ip: req.ip,
      path: req.path,
    });

    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Request contains potentially harmful content',
      },
    });
    return;
  }

  next();
}

/**
 * Request size limiter
 */
export function requestSizeLimiter(maxSize: number = 10 * 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxSize) {
      res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request size exceeds maximum allowed size of ${maxSize} bytes`,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Maintenance mode middleware
 */
export function maintenanceMode(req: Request, res: Response, next: NextFunction): void {
  if (config.features.maintenanceMode) {
    // Allow health check endpoints
    if (req.path === '/health' || req.path === '/api/health') {
      next();
      return;
    }

    res.status(503).json({
      success: false,
      error: {
        code: 'MAINTENANCE_MODE',
        message: 'System is under maintenance. Please try again later.',
      },
    });
    return;
  }

  next();
}

/**
 * Request ID middleware
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.headers['x-request-id'] as string || generateRequestId();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-ID', id);
  next();
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * User agent validation
 */
export function validateUserAgent(req: Request, res: Response, next: NextFunction): void {
  const userAgent = req.headers['user-agent'];

  if (!userAgent) {
    securityLog('missing_user_agent', 'low', { ip: req.ip, path: req.path });
  }

  // Block known bad bots
  const blockedBots = [
    'curl',
    'wget',
    'python-requests',
    'scrapy',
    'httpclient',
  ];

  if (userAgent) {
    const isBlocked = blockedBots.some((bot) =>
      userAgent.toLowerCase().includes(bot)
    );

    if (isBlocked && config.isProduction) {
      securityLog('blocked_bot', 'medium', {
        ip: req.ip,
        userAgent,
        path: req.path,
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      });
      return;
    }
  }

  next();
}

/**
 * Suspicious activity detector
 */
export function detectSuspiciousActivity(req: Request, res: Response, next: NextFunction): void {
  const suspiciousIndicators: string[] = [];

  // Check for path traversal attempts
  if (req.path.includes('..') || req.path.includes('%2e%2e')) {
    suspiciousIndicators.push('path_traversal');
  }

  // Check for null byte injection
  if (req.url.includes('%00') || req.url.includes('\x00')) {
    suspiciousIndicators.push('null_byte_injection');
  }

  // Check for common attack paths
  const attackPaths = [
    '/admin',
    '/wp-admin',
    '/phpmyadmin',
    '/.env',
    '/.git',
    '/config',
    '/backup',
  ];
  if (attackPaths.some((path) => req.path.toLowerCase().includes(path))) {
    suspiciousIndicators.push('attack_path_probe');
  }

  if (suspiciousIndicators.length > 0) {
    securityLog('suspicious_activity', 'medium', {
      ip: req.ip,
      path: req.path,
      indicators: suspiciousIndicators,
      userAgent: req.headers['user-agent'],
    });
  }

  next();
}

/**
 * API versioning check
 */
export function apiVersionCheck(req: Request, res: Response, next: NextFunction): void {
  const clientVersion = req.headers['x-client-version'] as string;
  
  // Could implement minimum version requirements here
  if (clientVersion) {
    res.setHeader('X-API-Version', config.apiVersion);
  }

  next();
}

/**
 * Combine all security middleware
 */
export function securityMiddleware() {
  return [
    requestId,
    corsMiddleware,
    helmetMiddleware,
    maintenanceMode,
    validateUserAgent,
    detectSuspiciousActivity,
    sanitizeRequest,
    sqlInjectionProtection,
    xssProtection,
    apiVersionCheck,
  ];
}

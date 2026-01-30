import winston from 'winston';
import { config } from '../config/index.js';

const { combine, timestamp, errors, json, colorize, printf, splat } = winston.format;

// Custom format for development
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Production format (JSON for log aggregation)
const prodFormat = combine(
  timestamp({ format: 'ISO' }),
  errors({ stack: true }),
  splat(),
  json()
);

// Development format (human readable)
const developmentFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  devFormat
);

// Create logger instance
export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.isProduction ? prodFormat : developmentFormat,
  defaultMeta: { service: 'exchange-api' },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

// Add file transports in production
if (config.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 10,
    })
  );
}

// Request logger middleware
export function requestLogger(
  req: { method: string; url: string; ip: string; headers: Record<string, unknown> },
  res: { statusCode: number },
  responseTime: number
): void {
  const logData = {
    method: req.method,
    url: req.url,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };

  if (res.statusCode >= 500) {
    logger.error('Request completed with server error', logData);
  } else if (res.statusCode >= 400) {
    logger.warn('Request completed with client error', logData);
  } else {
    logger.info('Request completed', logData);
  }
}

// Audit logger for sensitive operations
export function auditLog(
  action: string,
  userId: string | null,
  details: Record<string, unknown>,
  ip?: string
): void {
  logger.info('AUDIT', {
    action,
    userId,
    details,
    ip,
    timestamp: new Date().toISOString(),
  });
}

// Security event logger
export function securityLog(
  event: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  details: Record<string, unknown>
): void {
  const logLevel = severity === 'critical' || severity === 'high' ? 'error' : 'warn';
  logger[logLevel]('SECURITY_EVENT', {
    event,
    severity,
    details,
    timestamp: new Date().toISOString(),
  });
}

export default logger;

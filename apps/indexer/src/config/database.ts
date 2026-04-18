import dotenv from 'dotenv';
import path from 'path';
// Ensure .env is loaded before reading DATABASE_URL (ES modules hoist imports,
// so index.ts's dotenv.config() runs after this file is evaluated).
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { Pool } from 'pg';
import { logger } from '../utils/logger';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://exchange:exchange_secret@localhost:5432/exchange';

const isRemoteDb = DATABASE_URL.includes('supabase.co') || DATABASE_URL.includes('neon.tech') || process.env.DATABASE_SSL === 'true';

/** Manually parse the Postgres URL so IPv6 literals `[...]` don't leak into getaddrinfo. */
function parseConnectionString(url: string): {
  host: string; port: number; user: string; password: string; database: string;
} | null {
  const match = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@(\[[^\]]+\]|[^:/]+):(\d+)\/([^?]+)/);
  if (!match) return null;
  const [, user, password, hostRaw, portStr, database] = match;
  const host = hostRaw!.startsWith('[') ? hostRaw!.slice(1, -1) : hostRaw!;
  return {
    host,
    port: parseInt(portStr!, 10),
    user: decodeURIComponent(user!),
    password: decodeURIComponent(password!),
    database: database!,
  };
}

const parsed = parseConnectionString(DATABASE_URL);

export const pool = new Pool({
  ...(parsed ?? { connectionString: DATABASE_URL }),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ...(isRemoteDb ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query', { text, duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    logger.error('Database query error', { text, error });
    throw error;
  }
};

export const getClient = () => pool.connect();

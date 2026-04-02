import { Pool } from 'pg';
import { logger } from '../utils/logger';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://exchange:exchange_secret@localhost:5432/exchange';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
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

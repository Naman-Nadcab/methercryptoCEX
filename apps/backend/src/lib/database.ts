import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/** Minimal interface for query execution. Use for Pool | PoolClient union. */
export type Queryable = { query<T = any>(...args: any[]): Promise<any> };
import { config } from '../config/index.js';
import { logger } from './logger.js';

const SLOW_QUERY_MS = 100;

class Database {
  private pool: Pool;
  private readPool: Pool | null = null;
  private static instance: Database;

  private constructor() {
    const sslConfig = config.database.url.includes('localhost') || config.database.url.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: config.database.sslRejectUnauthorized };
    this.pool = new Pool({
      connectionString: config.database.url,
      min: Math.max(config.database.poolMin, 5),
      max: Math.max(config.database.poolMax, 50),
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 15000,
      statement_timeout: 30000,
      ...(sslConfig && { ssl: sslConfig }),
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });

    this.pool.on('connect', () => {
      logger.debug('New database connection established');
    });

    if (config.database.readReplicaUrl) {
      const readSsl = config.database.readReplicaUrl.includes('localhost') || config.database.readReplicaUrl.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: config.database.sslRejectUnauthorized };
      this.readPool = new Pool({
        connectionString: config.database.readReplicaUrl,
        min: Math.max(1, Math.floor(config.database.poolMin / 2)),
        max: config.database.poolMax,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ...(readSsl && { ssl: readSsl }),
      });
    }
  }

  /** For read-only queries when read replica is configured. Use for heavy SELECTs (orderbook, tickers). */
  async queryRead<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const pool = this.readPool ?? this.pool;
    return pool.query<T>(text, params);
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  /** Runtime guard: block any access to deprecated balances table (user_balances is the only source of truth). */
  private static guardDeprecatedBalancesTable(text: string): void {
    const normalized = text.replace(/\s+/g, ' ').trim();
    // Match FROM balances, JOIN balances, INTO balances, UPDATE balances (not user_balances)
    if (/\b(?:FROM|JOIN|INTO|UPDATE)\s+balances\b/i.test(normalized) && !/user_balances/i.test(normalized)) {
      logger.error('[BALANCE_VIOLATION] legacy balances access detected', { query: text.substring(0, 200) });
      throw new Error('balances table is deprecated – use user_balances only. Do not read or write balances in runtime code.');
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    Database.guardDeprecatedBalancesTable(text);
    const start = Date.now();
    const operation = text.replace(/\s+/g, ' ').trim().substring(0, 80);
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      const durationSec = duration / 1000;
      try {
        const { dbQueryDuration, dbSlowQueriesTotal } = await import('./prometheus-metrics.js');
        dbQueryDuration.observe({ operation: operation || 'query' }, durationSec);
        if (duration >= SLOW_QUERY_MS) {
          dbSlowQueriesTotal.inc({ operation: operation || 'query' });
          logger.warn('Slow query', { operation, duration_ms: duration, rows: result.rowCount });
        }
      } catch {
        /* metrics optional */
      }
      logger.debug('Executed query', { text: operation, duration, rows: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Database query error', {
        text: operation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /** Wrap PoolClient so every query is checked for deprecated balances table access. */
  private wrapClient(client: PoolClient): PoolClient {
    const guard = Database.guardDeprecatedBalancesTable;
    const origQuery = client.query.bind(client);
    return new Proxy(client, {
      get(target, prop: string) {
        if (prop === 'query') {
          return function (text: string, params?: unknown[]) {
            guard(text);
            return origQuery(text, params);
          };
        }
        return (target as unknown as Record<string, unknown>)[prop];
      },
    }) as PoolClient;
  }

  async getClient(): Promise<PoolClient> {
    const client = await this.pool.connect();
    return this.wrapClient(client);
  }

  /** Raw client for Phase-8 settlement pipeline only (balances table). Bypasses legacy balances guard. */
  async getSettlementClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const raw = await this.pool.connect();
    const client = this.wrapClient(raw);
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await raw.query('ROLLBACK');
      throw error;
    } finally {
      raw.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT 1');
      return result.rowCount === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }

  getPool(): Pool {
    return this.pool;
  }
}

export const db = Database.getInstance();

// Query builder helpers for type safety
export interface WhereClause {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
  value?: unknown;
}

export function buildWhereClause(
  clauses: WhereClause[],
  startIndex = 1
): { text: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = startIndex;

  for (const clause of clauses) {
    if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
      conditions.push(`${clause.field} ${clause.operator}`);
    } else if (clause.operator === 'IN' && Array.isArray(clause.value)) {
      const placeholders = clause.value.map((_, i) => `$${paramIndex + i}`).join(', ');
      conditions.push(`${clause.field} IN (${placeholders})`);
      values.push(...clause.value);
      paramIndex += clause.value.length;
    } else {
      conditions.push(`${clause.field} ${clause.operator} $${paramIndex}`);
      values.push(clause.value);
      paramIndex++;
    }
  }

  return {
    text: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

// Pagination helper
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function buildPaginationClause(
  params: PaginationParams,
  startIndex: number
): { text: string; values: [number, number] } {
  const offset = (params.page - 1) * params.limit;
  return {
    text: `LIMIT $${startIndex} OFFSET $${startIndex + 1}`,
    values: [params.limit, offset],
  };
}

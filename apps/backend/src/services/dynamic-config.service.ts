/**
 * Dynamic Configuration Service
 * Reads integration config (SMTP, SMS, RPC, KYC) from api_settings table with Redis caching.
 * Falls back to process.env when no active DB config exists.
 * Admin UI updates → DB → Redis cache invalidated on next TTL expiry or explicit flush.
 */
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

const CACHE_PREFIX = 'dynconf:';
const DEFAULT_TTL_SEC = 60; // 1 minute cache — balance between freshness and DB load

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

export interface SmsConfig {
  provider: 'twilio' | 'msg91' | 'textlocal' | 'fast2sms';
  apiKey: string;
  apiSecret?: string;
  senderId?: string;
  messageId?: string;
  route?: string;
}

export interface KycConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
  sandboxMode: boolean;
}

export interface RpcConfig {
  chainSlug: string;
  rpcUrl: string;
  wsUrl?: string;
  backupUrl?: string;
  timeout: number;
}

interface ApiSettingRow {
  id: string;
  category: string;
  provider: string;
  name: string;
  api_key: string | null;
  api_secret: string | null;
  api_url: string | null;
  additional_config: Record<string, string> | null;
  is_active: boolean;
  is_default: boolean;
}

class DynamicConfigService {
  private async getCached<T>(key: string): Promise<T | null> {
    try {
      return await redis.getJson<T>(`${CACHE_PREFIX}${key}`);
    } catch {
      return null;
    }
  }

  private async setCache<T>(key: string, value: T, ttl = DEFAULT_TTL_SEC): Promise<void> {
    try {
      await redis.setJson(`${CACHE_PREFIX}${key}`, value, ttl);
    } catch { /* best effort */ }
  }

  async flushCategory(category: string): Promise<void> {
    try {
      await redis.del(`${CACHE_PREFIX}${category}:active`);
      logger.info(`Dynamic config cache flushed for category: ${category}`);
    } catch { /* best effort */ }
  }

  async flushAll(): Promise<void> {
    const categories = ['email', 'sms', 'kyc', 'rpc', 'chart', 'market_data', 'push', 'oauth', 'recaptcha'];
    await Promise.all(categories.map(c => this.flushCategory(c)));
  }

  private async getActiveSettings(category: string): Promise<ApiSettingRow[]> {
    const cacheKey = `${category}:active`;
    const cached = await this.getCached<ApiSettingRow[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await db.query<ApiSettingRow>(
        `SELECT id, category, provider, name, api_key, api_secret, api_url, additional_config, is_active, is_default
         FROM api_settings WHERE category = $1 AND is_active = TRUE
         ORDER BY is_default DESC, updated_at DESC`,
        [category]
      );
      const rows = result.rows;
      await this.setCache(cacheKey, rows);
      return rows;
    } catch (error) {
      logger.error('Failed to fetch dynamic config', { category, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getSmtpConfig(): Promise<SmtpConfig | null> {
    const rows = await this.getActiveSettings('email');
    if (rows.length > 0) {
      const row = rows[0]!;
      const extra = row.additional_config || {};
      if (row.api_key && (extra.host || row.api_url)) {
        return {
          host: extra.host || row.api_url || '',
          port: parseInt(extra.port || '465', 10),
          secure: extra.secure === 'true' || parseInt(extra.port || '465', 10) === 465,
          user: row.api_key,
          pass: row.api_secret || '',
          fromEmail: extra.from_email || extra.from || config.email.from,
          fromName: extra.from_name || 'CryptoExchange',
        };
      }
    }

    if (config.email.user && (config.email.password || process.env.SMTP_PASS)) {
      let fromEmail = config.email.from;
      let fromName = 'CryptoExchange';
      const angleMatch = fromEmail.match(/<([^>]+)>/);
      if (angleMatch) {
        fromName = fromEmail.replace(/<[^>]+>/, '').replace(/^["'\s]+|["'\s]+$/g, '').trim() || fromName;
        fromEmail = angleMatch[1]!;
      }
      return {
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        user: config.email.user,
        pass: config.email.password || process.env.SMTP_PASS || '',
        fromEmail,
        fromName,
      };
    }

    return null;
  }

  async getSmsConfig(): Promise<SmsConfig | null> {
    const rows = await this.getActiveSettings('sms');
    if (rows.length > 0) {
      const row = rows[0]!;
      const extra = row.additional_config || {};
      if (row.api_key) {
        return {
          provider: row.provider as SmsConfig['provider'],
          apiKey: row.api_key,
          apiSecret: row.api_secret ?? extra.api_secret ?? undefined,
          senderId: extra.sender_id || 'INRXPE',
          messageId: extra.message_id || '181649',
          route: extra.route || 'dlt',
        };
      }
    }

    const twilioSid = config.sms.twilio.accountSid;
    const twilioToken = config.sms.twilio.authToken;
    const twilioPhone = config.sms.twilio.phoneNumber;
    if (twilioSid && twilioToken && twilioPhone) {
      return { provider: 'twilio', apiKey: twilioSid, apiSecret: twilioToken, senderId: twilioPhone };
    }

    if (process.env.SMS_API_KEY) {
      return {
        provider: (process.env.SMS_PROVIDER || 'twilio') as SmsConfig['provider'],
        apiKey: process.env.SMS_API_KEY,
        apiSecret: process.env.SMS_API_SECRET,
        senderId: process.env.SMS_SENDER_ID,
      };
    }

    return null;
  }

  async getKycConfig(): Promise<KycConfig | null> {
    const rows = await this.getActiveSettings('kyc');
    if (rows.length > 0) {
      const row = rows[0]!;
      const extra = row.additional_config || {};
      if (row.api_key) {
        return {
          provider: row.provider,
          baseUrl: row.api_url || extra.base_url || '',
          apiKey: row.api_key,
          apiSecret: row.api_secret ?? undefined,
          webhookSecret: extra.webhook_secret,
          sandboxMode: extra.sandbox_mode === 'true',
        };
      }
    }

    if (config.kyc.hyperverge.appId && config.kyc.hyperverge.appKey) {
      return {
        provider: 'hyperverge',
        baseUrl: config.kyc.hyperverge.baseUrl || '',
        apiKey: config.kyc.hyperverge.appId,
        apiSecret: config.kyc.hyperverge.appKey,
        sandboxMode: false,
      };
    }

    return null;
  }

  async getRpcConfigs(): Promise<RpcConfig[]> {
    const rows = await this.getActiveSettings('rpc');
    const configs: RpcConfig[] = [];

    for (const row of rows) {
      const extra = row.additional_config || {};
      configs.push({
        chainSlug: row.provider,
        rpcUrl: row.api_url || row.api_key || '',
        wsUrl: extra.ws_url,
        backupUrl: extra.backup_url,
        timeout: parseInt(extra.timeout || '30000', 10),
      });
    }

    return configs;
  }

  /** Test SMTP connection by sending a test email or verifying transport */
  async testSmtp(settingId: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await db.query<ApiSettingRow>('SELECT * FROM api_settings WHERE id = $1', [settingId]);
      if (result.rows.length === 0) return { success: false, message: 'Setting not found', latencyMs: 0 };

      const row = result.rows[0]!;
      const extra = row.additional_config || {};
      const host = extra.host || row.api_url;
      const port = parseInt(extra.port || '465', 10);
      const user = row.api_key;
      const pass = row.api_secret;

      if (!host || !user || !pass) {
        return { success: false, message: 'Missing SMTP credentials (host, user, or password)', latencyMs: Date.now() - start };
      }

      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host,
        port,
        secure: port === 465,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        auth: { user, pass },
      });

      await transporter.verify();
      transporter.close();
      return { success: true, message: `SMTP connection to ${host}:${port} verified`, latencyMs: Date.now() - start };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error', latencyMs: Date.now() - start };
    }
  }

  /** Test SMS by sending to the provider's validation endpoint (no actual SMS sent) */
  async testSms(settingId: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await db.query<ApiSettingRow>('SELECT * FROM api_settings WHERE id = $1', [settingId]);
      if (result.rows.length === 0) return { success: false, message: 'Setting not found', latencyMs: 0 };

      const row = result.rows[0]!;
      if (!row.api_key) return { success: false, message: 'API key is missing', latencyMs: Date.now() - start };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      let testUrl: string;
      let testOpts: RequestInit;

      switch (row.provider) {
        case 'twilio': {
          testUrl = `https://api.twilio.com/2010-04-01/Accounts/${row.api_key}.json`;
          testOpts = {
            headers: { Authorization: 'Basic ' + Buffer.from(`${row.api_key}:${row.api_secret}`).toString('base64') },
            signal: controller.signal,
          };
          break;
        }
        case 'fast2sms': {
          testUrl = `https://www.fast2sms.com/dev/wallet`;
          testOpts = {
            headers: { authorization: row.api_key, 'cache-control': 'no-cache' },
            signal: controller.signal,
          };
          break;
        }
        case 'msg91': {
          testUrl = `https://control.msg91.com/api/v5/report/all?authkey=${row.api_key}&limit=1`;
          testOpts = { signal: controller.signal };
          break;
        }
        default: {
          clearTimeout(timeout);
          return { success: true, message: `Provider '${row.provider}' has no test endpoint; credentials saved.`, latencyMs: Date.now() - start };
        }
      }

      const res = await fetch(testUrl, testOpts);
      clearTimeout(timeout);

      if (res.ok) {
        return { success: true, message: `${row.provider} API responded OK (${res.status})`, latencyMs: Date.now() - start };
      }
      return { success: false, message: `${row.provider} returned ${res.status}: ${res.statusText}`, latencyMs: Date.now() - start };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error', latencyMs: Date.now() - start };
    }
  }

  /** Test RPC by calling eth_blockNumber or equivalent */
  async testRpc(settingId: string): Promise<{ success: boolean; message: string; latencyMs: number; blockNumber?: string }> {
    const start = Date.now();
    try {
      const result = await db.query<ApiSettingRow>('SELECT * FROM api_settings WHERE id = $1', [settingId]);
      if (result.rows.length === 0) return { success: false, message: 'Setting not found', latencyMs: 0 };

      const row = result.rows[0]!;
      const rpcUrl = row.api_url || row.api_key;
      if (!rpcUrl) return { success: false, message: 'RPC URL is missing', latencyMs: Date.now() - start };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { success: false, message: `RPC returned ${res.status}`, latencyMs: Date.now() - start };
      }

      const data = await res.json() as { result?: string; error?: { message?: string } };
      if (data.error) {
        return { success: false, message: data.error.message || 'RPC error', latencyMs: Date.now() - start };
      }

      const blockNum = data.result ? parseInt(data.result, 16).toString() : 'unknown';
      return { success: true, message: `Connected. Latest block: ${blockNum}`, latencyMs: Date.now() - start, blockNumber: blockNum };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error', latencyMs: Date.now() - start };
    }
  }

  /** Test KYC provider by hitting its health/status endpoint */
  async testKyc(settingId: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await db.query<ApiSettingRow>('SELECT * FROM api_settings WHERE id = $1', [settingId]);
      if (result.rows.length === 0) return { success: false, message: 'Setting not found', latencyMs: 0 };

      const row = result.rows[0]!;
      const baseUrl = row.api_url;

      if (!baseUrl || !row.api_key) {
        return { success: false, message: 'Base URL or API key is missing', latencyMs: Date.now() - start };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const healthUrl = baseUrl.replace(/\/$/, '') + '/api/v1/health';
      const res = await fetch(healthUrl, {
        headers: { 'appId': row.api_key, 'appKey': row.api_secret || '' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return { success: true, message: `KYC provider (${row.provider}) is reachable`, latencyMs: Date.now() - start };
      }
      return { success: false, message: `KYC provider returned ${res.status}`, latencyMs: Date.now() - start };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error', latencyMs: Date.now() - start };
    }
  }
}

export const dynamicConfig = new DynamicConfigService();

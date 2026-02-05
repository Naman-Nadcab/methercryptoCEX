import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

interface OTPConfig {
  email?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  sms?: {
    provider: 'twilio' | 'msg91' | 'textlocal' | 'fast2sms';
    apiKey: string;
    apiSecret?: string;
    senderId?: string;
    messageId?: string; // For DLT templates (Fast2SMS)
    route?: string; // For Fast2SMS route
  };
}

class OTPService {
  private emailTransporter: nodemailer.Transporter | null = null;
  private smsConfig: OTPConfig['sms'] | null = null;

  constructor() {
    // Initialize email transporter if configured
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    
    if (smtpHost && smtpUser && smtpPass) {
      const smtpPort = parseInt(process.env.SMTP_PORT || '465');
      const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
      
      this.emailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      
      logger.info(`Email OTP service initialized with SMTP (${smtpHost}:${smtpPort})`);
    } else {
      logger.info('Email OTP service running in DEV mode (OTPs will be logged)');
    }

    // Initialize SMS config if configured (Twilio)
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    
    if (twilioSid && twilioToken && twilioPhone) {
      this.smsConfig = {
        provider: 'twilio',
        apiKey: twilioSid,
        apiSecret: twilioToken,
        senderId: twilioPhone,
      };
      logger.info('SMS OTP service initialized (Twilio)');
    } else if (process.env.SMS_PROVIDER && process.env.SMS_API_KEY) {
      this.smsConfig = {
        provider: process.env.SMS_PROVIDER as 'twilio' | 'msg91' | 'textlocal',
        apiKey: process.env.SMS_API_KEY,
        apiSecret: process.env.SMS_API_SECRET,
        senderId: process.env.SMS_SENDER_ID,
      };
      logger.info(`SMS OTP service initialized (${this.smsConfig.provider})`);
    } else {
      logger.info('SMS OTP service running in DEV mode (OTPs will be logged)');
    }
  }

  /**
   * Generate a random OTP
   */
  generateOTP(length: number = 6): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  /**
   * Hash OTP for storage
   */
  hashOTP(otp: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(otp).digest('hex');
  }

  /**
   * Generate salt
   */
  generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Send OTP via Email
   */
  async sendEmailOTP(email: string, otp: string): Promise<boolean> {
    // If no SMTP configured, log OTP for development
    if (!this.emailTransporter) {
      console.log(`\n📧 [DEV] Email OTP for ${email}: ${otp}\n`);
      logger.info(`[DEV] Email OTP for ${email}: ${otp}`);
      return true;
    }

    try {
      await this.emailTransporter.sendMail({
        from: process.env.SMTP_FROM || '"CryptoExchange" <onboarding@resend.dev>',
        to: email,
        subject: 'Your Verification Code - CryptoExchange',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">CryptoExchange</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <h2 style="color: #1f2937;">Verification Code</h2>
              <p style="color: #4b5563;">Your one-time verification code is:</p>
              <div style="background: #1f2937; color: #fbbf24; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                ${otp}
              </div>
              <p style="color: #6b7280; font-size: 14px;">This code will expire in 10 minutes.</p>
              <p style="color: #6b7280; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
            </div>
            <div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
              © 2024 CryptoExchange. All rights reserved.
            </div>
          </div>
        `,
        text: `Your CryptoExchange verification code is: ${otp}. This code will expire in 10 minutes.`,
      });

      logger.info(`Email OTP sent to ${email}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown';
      logger.warn('SMTP send failed', { error: errorMessage, email });
      // OTP is already stored in DB; log it once so flow can continue (user/support can use from logs if needed)
      logger.info(`[OTP FALLBACK] Email OTP for ${email}: ${otp} (use this code to login)`);
      // Always return true so login flow is not blocked; verify will work from DB
      return true;
    }
  }

  /**
   * Send OTP via SMS
   */
  async sendSMSOTP(phone: string, otp: string): Promise<boolean> {
    // Try to get SMS config from database first
    const dbConfig = await this.getSMSConfigFromDB();
    const smsConfig = dbConfig || this.smsConfig;

    if (!smsConfig) {
      // In development, just log the OTP
      logger.info(`[DEV] SMS OTP for ${phone}: ${otp}`);
      return true;
    }

    try {
      const message = `Your Methereum verification code is: ${otp}. Valid for 10 minutes.`;

      switch (smsConfig.provider) {
        case 'twilio':
          await this.sendViaTwilio(phone, message, smsConfig);
          break;
        case 'msg91':
          await this.sendViaMSG91(phone, otp, smsConfig);
          break;
        case 'textlocal':
          await this.sendViaTextLocal(phone, message, smsConfig);
          break;
        case 'fast2sms':
          await this.sendViaFast2SMS(phone, otp, smsConfig);
          break;
        default:
          throw new Error('Unknown SMS provider');
      }

      logger.info(`SMS OTP sent to ${phone}`);
      return true;
    } catch (error) {
      logger.error('Failed to send SMS OTP', { error: error instanceof Error ? error.message : 'Unknown', phone });
      
      // Fallback to dev mode logging
      if (process.env.NODE_ENV !== 'production') {
        logger.info(`[DEV FALLBACK] SMS OTP for ${phone}: ${otp}`);
        return true;
      }
      return false;
    }
  }

  /**
   * Get SMS config from database
   * Prioritizes fast2sms for Indian numbers
   */
  private async getSMSConfigFromDB(): Promise<OTPConfig['sms'] | null> {
    try {
      // Prioritize fast2sms, then other providers
      const result = await db.query<{ 
        provider: string;
        api_key: string;
        additional_config: Record<string, string>;
      }>(
        `SELECT provider, api_key, additional_config FROM api_settings 
         WHERE category = 'sms' AND is_active = TRUE 
         ORDER BY 
           CASE WHEN provider = 'fast2sms' THEN 0 ELSE 1 END,
           is_default DESC 
         LIMIT 1`
      );

      if (result.rows.length > 0 && result.rows[0]) {
        const row = result.rows[0];
        const config = row.additional_config || {};
        
        logger.info('Using SMS provider', { provider: row.provider });
        
        return {
          provider: row.provider as any,
          apiKey: row.api_key || config.api_key || '',
          senderId: config.sender_id || 'INRXPE',
          messageId: config.message_id || '181649',
          route: config.route || 'dlt',
        };
      }
      return null;
    } catch (error) {
      logger.error('Failed to get SMS config from DB', { error: error instanceof Error ? error.message : 'Unknown' });
      return null;
    }
  }

  private async sendViaTwilio(phone: string, message: string, config: OTPConfig['sms']): Promise<void> {
    const accountSid = config!.apiKey;
    const authToken = config!.apiSecret;
    const fromNumber = config!.senderId;

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: phone,
          From: fromNumber!,
          Body: message,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Twilio error: ${response.statusText}`);
    }
  }

  private async sendViaMSG91(phone: string, otp: string, config: OTPConfig['sms']): Promise<void> {
    const authKey = config!.apiKey;
    const senderId = config!.senderId || 'EXCHNG';

    const response = await fetch(
      `https://api.msg91.com/api/v5/otp?template_id=YOUR_TEMPLATE_ID&mobile=${phone}&authkey=${authKey}&otp=${otp}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      throw new Error(`MSG91 error: ${response.statusText}`);
    }
  }

  private async sendViaTextLocal(phone: string, message: string, config: OTPConfig['sms']): Promise<void> {
    const apiKey = config!.apiKey;
    const sender = config!.senderId || 'EXCHNG';

    const response = await fetch(
      `https://api.textlocal.in/send/?apikey=${apiKey}&numbers=${phone}&message=${encodeURIComponent(message)}&sender=${sender}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      throw new Error(`TextLocal error: ${response.statusText}`);
    }
  }

  /**
   * Send SMS via Fast2SMS (DLT Route for India)
   */
  private async sendViaFast2SMS(phone: string, otp: string, config: OTPConfig['sms']): Promise<void> {
    const apiKey = config!.apiKey;
    const senderId = config!.senderId || 'INRXPE';
    const messageId = config!.messageId || '181649';
    const route = config!.route || 'dlt';

    // Clean phone number - remove +91 or 91 prefix if present
    let cleanPhone = phone.replace(/^\+?91/, '').replace(/\D/g, '');
    
    // Ensure it's a 10-digit number
    if (cleanPhone.length !== 10) {
      throw new Error(`Invalid phone number format: ${phone}`);
    }

    const url = new URL('https://www.fast2sms.com/dev/bulkV2');
    url.searchParams.append('authorization', apiKey);
    url.searchParams.append('route', route);
    url.searchParams.append('sender_id', senderId);
    url.searchParams.append('message', messageId);
    url.searchParams.append('variables_values', otp);
    url.searchParams.append('flash', '0');
    url.searchParams.append('numbers', cleanPhone);

    logger.info('Sending Fast2SMS request', { phone: cleanPhone, messageId, route });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'cache-control': 'no-cache',
      },
    });

    const data = await response.json();
    
    if (!response.ok || data.return === false) {
      logger.error('Fast2SMS error response', { data });
      throw new Error(`Fast2SMS error: ${data.message || response.statusText}`);
    }

    logger.info('Fast2SMS success', { requestId: data.request_id, messageIds: data.message_ids });
  }

  /**
   * Create and store OTP
   */
  async createOTP(identifier: string, type: 'email' | 'phone'): Promise<{ otp: string; expiresAt: Date }> {
    try {
      const otp = this.generateOTP(6);
      const salt = this.generateSalt();
      const otpHash = this.hashOTP(otp, salt);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Delete any existing OTPs for this identifier
      await db.query(
        `DELETE FROM otp_verifications WHERE identifier = $1 AND type = $2 AND verified_at IS NULL`,
        [identifier, type]
      );

      // Store new OTP
      await db.query(
        `INSERT INTO otp_verifications (identifier, type, otp_hash, salt, expires_at, max_attempts)
         VALUES ($1, $2, $3, $4, $5, 3)`,
        [identifier, type, otpHash, salt, expiresAt]
      );

      // Also store in Redis for quick access (optional; DB is source of truth)
      try {
        await redis.setJson(`otp:${type}:${identifier}`, {
          hash: otpHash,
          salt,
          attempts: 0,
          expiresAt: expiresAt.toISOString(),
        }, 600); // 10 minutes TTL
      } catch {
        // Redis down: OTP is still in DB, verifyOTP will fall back to DB
      }

      logger.info('OTP created', { identifier, type, expiresAt });
      return { otp, expiresAt };
    } catch (error) {
      logger.error('Failed to create OTP', { error: error instanceof Error ? error.message : 'Unknown', identifier, type });
      throw error;
    }
  }

  /**
   * Verify OTP. Uses DB as source of truth; Redis is optional cache. If Redis is down/closed, falls back to DB only.
   */
  async verifyOTP(identifier: string, type: 'email' | 'phone', otp: string): Promise<{ valid: boolean; message: string }> {
    const cacheKey = `otp:${type}:${identifier}`;

    let cached: { hash: string; salt: string; attempts: number; expiresAt: string } | null = null;
    try {
      cached = await redis.getJson<{ hash: string; salt: string; attempts: number; expiresAt: string }>(cacheKey);
    } catch {
      // Redis down or connection closed: use DB only
    }

    if (!cached) {
      return this.verifyOTPFromDb(identifier, type, otp, cacheKey);
    }

    // Verify from cache
    if (new Date(cached.expiresAt) < new Date()) {
      try { await redis.del(cacheKey); } catch { /* best effort */ }
      return { valid: false, message: 'OTP has expired' };
    }

    if (cached.attempts >= 3) {
      return { valid: false, message: 'Maximum attempts exceeded' };
    }

    const isValid = this.hashOTP(otp, cached.salt) === cached.hash;

    if (!isValid) {
      cached.attempts++;
      try { await redis.setJson(cacheKey, cached, 600); } catch { /* best effort */ }
      await db.query(
        `UPDATE otp_verifications SET attempts = attempts + 1 
         WHERE identifier = $1 AND type = $2 AND verified_at IS NULL`,
        [identifier, type]
      );
      return { valid: false, message: 'Invalid OTP' };
    }

    // Mark as verified in DB (source of truth)
    await db.query(
      `UPDATE otp_verifications SET verified_at = NOW() 
       WHERE identifier = $1 AND type = $2 AND verified_at IS NULL`,
      [identifier, type]
    );
    try { await redis.del(cacheKey); } catch { /* best effort */ }
    return { valid: true, message: 'OTP verified successfully' };
  }

  private async verifyOTPFromDb(
    identifier: string,
    type: 'email' | 'phone',
    otp: string,
    cacheKey: string
  ): Promise<{ valid: boolean; message: string }> {
    const result = await db.query<{
      id: string;
      otp_hash: string;
      salt: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date;
    }>(
      `SELECT * FROM otp_verifications 
       WHERE identifier = $1 AND type = $2 AND verified_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [identifier, type]
    );

    if (result.rows.length === 0) {
      return { valid: false, message: 'OTP not found or expired' };
    }

    const record = result.rows[0]!;

    if (new Date(record.expires_at) < new Date()) {
      return { valid: false, message: 'OTP has expired' };
    }

    if (record.attempts >= record.max_attempts) {
      return { valid: false, message: 'Maximum attempts exceeded' };
    }

    const isValid = this.hashOTP(otp, record.salt) === record.otp_hash;

    if (!isValid) {
      await db.query(
        'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1',
        [record.id]
      );
      return { valid: false, message: 'Invalid OTP' };
    }

    await db.query(
      'UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1',
      [record.id]
    );
    try { await redis.del(cacheKey); } catch { /* best effort */ }
    return { valid: true, message: 'OTP verified successfully' };
  }

  /**
   * Check rate limit for OTP requests. Fails open if Redis is down so OTP flow is not blocked.
   */
  async checkRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    try {
      const client = redis.getClient();
      const key = `otp:ratelimit:${identifier}`;
      const count = await client.incr(key);

      if (count === 1) {
        await client.expire(key, 60); // 1 minute window
      }

      if (count > 3) {
        const ttl = await client.ttl(key);
        return { allowed: false, retryAfter: Math.max(0, ttl) };
      }

      return { allowed: true };
    } catch (err) {
      logger.warn('Rate limit check failed (Redis?), allowing OTP', { error: err instanceof Error ? err.message : 'Unknown' });
      return { allowed: true };
    }
  }
}

export const otpService = new OTPService();

import { query } from '../config/database';
import { logger } from '../utils/logger';

interface EmailData {
  to: string;
  subject: string;
  html: string;
}

// Simple email service - in production use SendGrid, AWS SES, etc.
export class EmailService {
  private smtpHost: string;
  private smtpPort: number;
  private smtpUser: string;
  private smtpPass: string;
  private fromEmail: string;

  constructor() {
    this.smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    this.smtpPort = parseInt(process.env.SMTP_PORT || '587');
    this.smtpUser = process.env.SMTP_USER || '';
    this.smtpPass = process.env.SMTP_PASS || '';
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@methereum.com';
  }

  async sendDepositDetectedEmail(userId: string, data: {
    symbol: string;
    amount: string;
    chainName: string;
    txHash: string;
    requiredConfirmations: number;
    explorerUrl?: string;
  }): Promise<void> {
    try {
      // Get user email
      const userResult = await query(`SELECT email, first_name FROM users WHERE id = $1`, [userId]);
      if (userResult.rows.length === 0) return;
      
      const user = userResult.rows[0];
      const userName = user.first_name || 'User';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { padding: 30px; }
    .amount-box { background: #f8fafc; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
    .amount { font-size: 32px; font-weight: bold; color: #1e293b; }
    .symbol { color: #64748b; font-size: 18px; }
    .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
    .info-label { color: #64748b; }
    .info-value { color: #1e293b; font-weight: 500; }
    .status-pending { background: #fef3c7; color: #92400e; padding: 8px 16px; border-radius: 8px; display: inline-block; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 Deposit Detected</h1>
    </div>
    <div class="content">
      <p>Hi ${userName},</p>
      <p>We've detected a deposit to your Methereum account!</p>
      
      <div class="amount-box">
        <div class="amount">${data.amount}</div>
        <div class="symbol">${data.symbol}</div>
      </div>
      
      <div class="info-row">
        <span class="info-label">Network</span>
        <span class="info-value">${data.chainName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Transaction</span>
        <span class="info-value">${data.txHash.slice(0, 16)}...${data.txHash.slice(-8)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="status-pending">⏳ Waiting for ${data.requiredConfirmations} confirmations</span>
      </div>
      
      <p style="margin-top: 20px; color: #64748b;">
        Your deposit will be credited automatically once it receives the required confirmations.
        This usually takes a few minutes.
      </p>
      
      ${data.explorerUrl ? `<a href="${data.explorerUrl}" class="btn">View on Explorer</a>` : ''}
    </div>
    <div class="footer">
      <p>This is an automated notification from Methereum.</p>
      <p>© 2026 Methereum. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `;

      await this.sendEmail({
        to: user.email,
        subject: `🔔 Deposit Detected: ${data.amount} ${data.symbol}`,
        html,
      });

      logger.info('Deposit detected email sent', { userId, email: user.email, symbol: data.symbol });
    } catch (error) {
      logger.error('Failed to send deposit detected email', { userId, error });
    }
  }

  async sendDepositConfirmedEmail(userId: string, data: {
    symbol: string;
    amount: string;
    chainName: string;
    txHash: string;
    explorerUrl?: string;
  }): Promise<void> {
    try {
      // Get user email
      const userResult = await query(`SELECT email, first_name FROM users WHERE id = $1`, [userId]);
      if (userResult.rows.length === 0) return;
      
      const user = userResult.rows[0];
      const userName = user.first_name || 'User';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { padding: 30px; }
    .amount-box { background: #f0fdf4; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; border: 2px solid #86efac; }
    .amount { font-size: 32px; font-weight: bold; color: #166534; }
    .symbol { color: #16a34a; font-size: 18px; }
    .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
    .info-label { color: #64748b; }
    .info-value { color: #1e293b; font-weight: 500; }
    .status-success { background: #dcfce7; color: #166534; padding: 8px 16px; border-radius: 8px; display: inline-block; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; }
    .btn { display: inline-block; background: #059669; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Deposit Confirmed!</h1>
    </div>
    <div class="content">
      <p>Hi ${userName},</p>
      <p>Great news! Your deposit has been confirmed and credited to your account.</p>
      
      <div class="amount-box">
        <div class="amount">+${data.amount}</div>
        <div class="symbol">${data.symbol}</div>
      </div>
      
      <div class="info-row">
        <span class="info-label">Network</span>
        <span class="info-value">${data.chainName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Transaction</span>
        <span class="info-value">${data.txHash.slice(0, 16)}...${data.txHash.slice(-8)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="status-success">✓ Credited to your account</span>
      </div>
      
      <p style="margin-top: 20px; color: #64748b;">
        Your funds are now available in your Funding Account. You can now trade, transfer, or withdraw them.
      </p>
      
      <a href="https://methereum.com/dashboard/assets/funding" class="btn">View Balance</a>
    </div>
    <div class="footer">
      <p>This is an automated notification from Methereum.</p>
      <p>© 2026 Methereum. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `;

      await this.sendEmail({
        to: user.email,
        subject: `✅ Deposit Confirmed: +${data.amount} ${data.symbol}`,
        html,
      });

      logger.info('Deposit confirmed email sent', { userId, email: user.email, symbol: data.symbol });
    } catch (error) {
      logger.error('Failed to send deposit confirmed email', { userId, error });
    }
  }

  private async sendEmail(data: EmailData): Promise<void> {
    // In production, use a proper email service like SendGrid, AWS SES, etc.
    // For now, just log the email
    logger.info('📧 Email would be sent:', { 
      to: data.to, 
      subject: data.subject,
      // Don't log full HTML
    });

    // If SMTP credentials are configured, send actual email
    if (this.smtpUser && this.smtpPass) {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: this.smtpHost,
          port: this.smtpPort,
          secure: this.smtpPort === 465,
          auth: {
            user: this.smtpUser,
            pass: this.smtpPass,
          },
        });

        await transporter.sendMail({
          from: this.fromEmail,
          to: data.to,
          subject: data.subject,
          html: data.html,
        });
      } catch (error) {
        logger.error('SMTP send failed', { error });
      }
    }
  }
}

export const emailService = new EmailService();

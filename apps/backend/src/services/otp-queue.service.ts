/**
 * OTP delivery: default is direct SMTP/SMS from the API process (lowest latency).
 * Optional RabbitMQ path for high-volume / isolated workers: set OTP_USE_RABBITMQ_QUEUE=true.
 */

import { rabbitmq, QUEUES } from '../lib/rabbitmq.js';
import { otpService } from './otp.service.js';
import { logger } from '../lib/logger.js';

export interface OtpSendPayload {
  channel: 'email' | 'sms';
  identifier: string;
  otp: string;
}

const useRabbitForOtp = (): boolean => process.env.OTP_USE_RABBITMQ_QUEUE === 'true';

/**
 * Send OTP without blocking the HTTP handler (fire-and-forget).
 * By default uses direct delivery immediately; RabbitMQ only when explicitly enabled.
 */
export async function queueOtpSend(channel: 'email' | 'sms', identifier: string, otp: string): Promise<void> {
  if (useRabbitForOtp()) {
    const connected = await rabbitmq.healthCheck();
    if (connected) {
      const ok = await rabbitmq.sendToQueue(QUEUES.OTP_SEND, { channel, identifier, otp } satisfies OtpSendPayload);
      if (ok) return;
    }
    logger.warn('[otp-queue] RabbitMQ unavailable or send failed; falling back to direct OTP send');
  }
  (channel === 'email' ? otpService.sendEmailOTP(identifier, otp) : otpService.sendSMSOTP(identifier, otp)).catch(
    (err) => logger.warn('[otp-queue] direct send failed', { error: err instanceof Error ? err.message : String(err), identifier })
  );
}

/**
 * Process OTP send from queue. Call from worker.
 */
export async function processOtpSendJob(
  payload: OtpSendPayload,
  ack: () => void,
  nack: (requeue?: boolean) => void
): Promise<void> {
  const start = Date.now();
  try {
    if (payload.channel === 'email') {
      await otpService.sendEmailOTP(payload.identifier, payload.otp);
    } else {
      await otpService.sendSMSOTP(payload.identifier, payload.otp);
    }
    try {
      const { queueJobDuration } = await import('../lib/prometheus-metrics.js');
      queueJobDuration.observe({ queue: 'otp.send' }, (Date.now() - start) / 1000);
    } catch {
      /* metrics optional */
    }
    ack();
  } catch (err) {
    logger.error('[otp-queue] send failed', { channel: payload.channel, error: err instanceof Error ? err.message : String(err) });
    nack(false); // Do not requeue; OTP may expire
  }
}

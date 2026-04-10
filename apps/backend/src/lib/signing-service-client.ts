/**
 * Remote signing over HTTPS + mTLS + HMAC body authentication.
 * Main API / workers call this; private keys exist only in the signing listener process.
 */
import fs from 'node:fs';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let agent: https.Agent | undefined;

function getAgent(): https.Agent {
  if (agent) return agent;
  const s = config.signingService;
  if (!s.mtlsCaPath || !s.mtlsCertPath || !s.mtlsKeyPath) {
    throw new Error('Signing mTLS paths not configured (SIGNING_SERVICE_MTLS_CA_PATH, CERT, KEY)');
  }
  agent = new https.Agent({
    ca: fs.readFileSync(s.mtlsCaPath),
    cert: fs.readFileSync(s.mtlsCertPath),
    key: fs.readFileSync(s.mtlsKeyPath),
    rejectUnauthorized: true,
  });
  return agent;
}

export interface RemoteSignEvmNativeParams {
  withdrawalId: string;
  chainId: string;
  toAddress: string;
  valueWei: string;
  gasLimit: string;
}

export async function remoteSignEvmNativeTransaction(params: RemoteSignEvmNativeParams): Promise<string> {
  const s = config.signingService;
  if (!s.remoteEnabled || !s.baseUrl || !s.hmacSecret) {
    throw new Error('Remote signing not configured');
  }
  const body = JSON.stringify({
    withdrawal_id: params.withdrawalId,
    chain_id: params.chainId,
    to_address: params.toAddress,
    value_wei: params.valueWei,
    gas_limit: params.gasLimit,
  });
  const ts = String(Date.now());
  const sig = createHmac('sha256', s.hmacSecret).update(`${ts}.${body}`, 'utf8').digest('hex');
  const u = new URL('/v1/sign/evm-native', s.baseUrl.endsWith('/') ? s.baseUrl : `${s.baseUrl}/`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      u,
      {
        method: 'POST',
        agent: getAgent(),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Signing-Ts': ts,
          'X-Signing-Sig': sig,
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            const j = JSON.parse(raw) as { signed_tx_hex?: string; error?: string };
            if (res.statusCode === 200 && j.signed_tx_hex) {
              resolve(j.signed_tx_hex);
              return;
            }
            reject(new Error(j.error || raw || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(raw || `HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('signing request timeout'));
    });
    req.write(body);
    req.end();
  });
}

export function clearSigningAgentCache(): void {
  agent = undefined;
}

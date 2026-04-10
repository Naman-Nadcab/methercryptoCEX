/**
 * Standalone signing listener: mTLS + HMAC + Redis replay / duplicate protection.
 */
import fs from 'node:fs';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { getSignerForChain } from '../services/hot-wallet.service.js';

const ACTOR = 'signing-http-service';
const REQ_REPLAY_TTL_SEC = 60;
const WD_LOCK_TTL_SEC = 120;
const SIGNED_OUT_TTL_SEC = 604800;

function readEnvPath(name: string, required: true): string;
function readEnvPath(name: string, required: false): string | undefined;
function readEnvPath(name: string, required: boolean): string | undefined {
  const v = (process.env[name] ?? '').trim();
  if (!v && required) throw new Error(`${name} required`);
  return v || undefined;
}

function verifyHmac(secret: string, tsHeader: string | undefined, body: string, sigHeader: string | undefined): boolean {
  if (!secret || !tsHeader || !sigHeader) return false;
  const ts = parseInt(tsHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 120_000) return false;
  const expectedHex = createHmac('sha256', secret).update(`${tsHeader}.${body}`, 'utf8').digest('hex');
  if (sigHeader.length !== expectedHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sigHeader, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url?.split('?')[0] ?? '';
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'signing' }));
    return;
  }
  if (url !== '/v1/sign/evm-native' || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  const secret = config.signingService.hmacSecret ?? process.env.SIGNING_SERVICE_HMAC_SECRET?.trim();
  if (!secret) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SIGNING_SERVICE_HMAC_SECRET not set' }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  const ts = req.headers['x-signing-ts'] as string | undefined;
  const sig = req.headers['x-signing-sig'] as string | undefined;
  if (!verifyHmac(secret, ts, body, sig)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'INVALID_SIGNATURE' }));
    return;
  }

  let payload: {
    withdrawal_id?: string;
    chain_id?: string;
    to_address?: string;
    value_wei?: string;
    gas_limit?: string;
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'INVALID_JSON' }));
    return;
  }
  const wdid = String(payload.withdrawal_id ?? '').trim();
  const chainId = String(payload.chain_id ?? '').trim();
  const to = String(payload.to_address ?? '').trim();
  const valueWei = String(payload.value_wei ?? '').trim();
  const gasLimit = String(payload.gas_limit ?? '21000').trim();
  if (!wdid || !chainId || !to || !valueWei) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MISSING_FIELDS' }));
    return;
  }

  const reqHash = createHash('sha256').update(`${body}${ts}`, 'utf8').digest('hex');
  const reqKey = `sign:req:${reqHash}`;
  const lockKey = `sign:wd:${wdid}`;
  const outKey = `sign:out:${wdid}`;

  try {
    const existing = await redis.get(outKey);
    if (existing) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'DUPLICATE_WITHDRAWAL_SIGN' }));
      return;
    }

    const freshReq = await redis.setNxEx(reqKey, '1', REQ_REPLAY_TTL_SEC);
    if (!freshReq) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SIGN_REQUEST_REPLAY' }));
      return;
    }

    const gotLock = await redis.setNxEx(lockKey, '1', WD_LOCK_TTL_SEC);
    if (!gotLock) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SIGN_IN_FLIGHT' }));
      return;
    }

    let signer: Awaited<ReturnType<typeof getSignerForChain>>;
    try {
      signer = await getSignerForChain(chainId, ACTOR, 'withdrawal');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('signing-http: getSigner failed', { chainId, error: msg });
      await redis.del(lockKey);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
      return;
    }
    if (!signer) {
      await redis.del(lockKey);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NO_SIGNER' }));
      return;
    }

    let signed: string;
    try {
      signed = await signer.signTransaction({
        to,
        value: BigInt(valueWei),
        data: '0x',
        gasLimit: BigInt(gasLimit),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('signing-http: sign failed', { chainId, error: msg });
      await redis.del(lockKey);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
      return;
    }

    const outHash = createHash('sha256').update(signed, 'utf8').digest('hex');
    const sigDedupKey = `sign:sig:${outHash}`;
    const freshSig = await redis.setNxEx(sigDedupKey, wdid, REQ_REPLAY_TTL_SEC);
    if (!freshSig) {
      await redis.del(lockKey);
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'DUPLICATE_SIGNATURE_OUTPUT' }));
      return;
    }

    await redis.set(outKey, signed, SIGNED_OUT_TTL_SEC);
    await redis.del(lockKey);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signed_tx_hex: signed }));
  } catch (e) {
    logger.error('signing-http: redis or fatal', { error: e instanceof Error ? e.message : String(e) });
    try {
      await redis.del(lockKey);
    } catch {
      /* ignore */
    }
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SIGNING_SERVICE_UNAVAILABLE' }));
  }
}

export function startSigningHttpServer(): https.Server {
  const keyPath = readEnvPath('SIGNING_HTTP_TLS_KEY_PATH', true)!;
  const certPath = readEnvPath('SIGNING_HTTP_TLS_CERT_PATH', true)!;
  const caPath = readEnvPath('SIGNING_HTTP_TLS_CA_PATH', true)!;
  const port = parseInt(process.env.SIGNING_HTTP_PORT ?? '7420', 10);
  const bind = (process.env.SIGNING_HTTP_BIND ?? '0.0.0.0').trim();

  const opts: https.ServerOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    ca: fs.readFileSync(caPath),
    requestCert: true,
    rejectUnauthorized: true,
  };

  const server = https.createServer(opts, (req, res) => {
    void handle(req, res).catch((e) => {
      logger.error('signing-http: unhandled', { error: e instanceof Error ? e.message : String(e) });
      res.writeHead(500).end();
    });
  });

  server.listen(port, bind, () => {
    logger.info('signing-http: listening', { bind, port, mtls: true, replay_guard: true });
  });
  return server;
}

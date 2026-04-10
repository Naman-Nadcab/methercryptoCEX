import { createHmac, randomBytes } from 'crypto';

const secret =
  process.env.ENGINE_HMAC_SECRET_ACTIVE ||
  process.env.ENGINE_HMAC_SECRET ||
  '';
const user = process.env.E2E_ENGINE_SERVICE_USER_ID || '00000000-0000-0000-0000-000000000001';
const eid = process.env.E2E_ENGINE_INSTANCE_ID || 'default';
const pathQ = '/engine/snapshot?market=BTC_USDT';
if (!secret.trim()) {
  process.exit(2);
}
const nonce = `${Date.now()}-${randomBytes(8).toString('hex')}`;
const msg = `v2\n${user}\n${eid}\nGET\n${pathQ}\n\n${nonce}\n`;
const sig = createHmac('sha256', secret.trim()).update(msg, 'utf8').digest('hex');
console.log(JSON.stringify({ sig, nonce, user, eid }));

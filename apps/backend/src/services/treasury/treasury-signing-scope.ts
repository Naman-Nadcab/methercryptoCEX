/**
 * Signing worker boundary: only `withdrawal-signing`, `hot-wallet`, `kms` modules may load private keys.
 * When SIGNING_REMOTE_ENABLED=true, withdrawal workers must not call getSignerForChain; use signing HTTP + mTLS.
 * Standalone: `npm run start:signing-service` (dist/signing/signing-http-main.js).
 */
export const TREASURY_SIGNING_ALLOWED_IMPORT_PREFIXES = [
  'services/withdrawal-signing.service',
  'services/hot-wallet.service',
  'services/hot-wallet-sweep.service',
  'lib/kms',
] as const;

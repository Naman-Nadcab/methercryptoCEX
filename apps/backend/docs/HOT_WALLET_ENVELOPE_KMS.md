# Hot Wallet Envelope Encryption (KMS/HSM-style)

Hot wallet private keys use **envelope encryption**: a per-wallet Data Encryption Key (DEK) encrypts the private key; the DEK is encrypted by a master key (KMS or derived). No private key or DEK is ever returned to the API or logs.

## Target design

1. **Envelope encryption**
   - **Master key**: In KMS (e.g. AWS KMS) or derived from app config (local).
   - **DEK**: Per-wallet data key; generated per wallet, used only to encrypt/decrypt that wallet’s private key.

2. **Stored in DB (`hot_wallets`)**
   - **encrypted_private_key** – Private key encrypted with the DEK (AES-256-GCM).
   - **encrypted_dek** – DEK encrypted by KMS/master key. Format is provider-specific (local: `iv:authTag:ciphertext`; AWS: base64 of KMS CiphertextBlob).
   - **key_version** – Version of the master/key used to encrypt the DEK (supports rotation).

3. **At runtime**
   - KMS (or local) decrypts **encrypted_dek** → DEK (in memory only).
   - DEK decrypts **encrypted_private_key** → private key (in memory only).
   - Private key is used for signing, then zeroized. DEK is zeroized after use.

4. **Key rotation**
   - Rotate master key in KMS (or bump `KMS_KEY_VERSION` for local).
   - Re-encrypt each wallet’s DEK with the new master/key version; **encrypted_private_key** and the underlying private key do not change.
   - No need to regenerate wallets.

5. **Security**
   - No private key or DEK is ever returned to the API or written to logs.

---

## Schema

```sql
ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS encrypted_dek TEXT;
ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS key_version VARCHAR(20);
```

- **encrypted_private_key** – Still required. Meaning: with envelope, it is ciphertext from DEK (not from app key).
- **encrypted_dek** – NULL for legacy rows (pre-envelope).
- **key_version** – NULL for legacy; e.g. `'1'` for envelope rows.

Run migrations so these columns exist:

```bash
cd apps/backend && npm run migrate
```

---

## Config

| Env | Description | Default |
|-----|-------------|--------|
| **KMS_TYPE** | `local` \| `aws` | `local` |
| **KMS_KEY_VERSION** | Key version used for new envelopes (rotation) | `1` |
| **AWS_KMS_KEY_ID** | KMS key ID (when KMS_TYPE=aws) | - |
| **AWS_REGION** | AWS region (when KMS_TYPE=aws) | - |
| **ENCRYPTION_KEY** | Used for local KMS derivation (min 32 chars) | required |

- **local**: Master key = `SHA256(ENCRYPTION_KEY + ':' + keyVersion)`. DEK is encrypted with AES-256-GCM. Suitable for dev/single-node.
- **aws**: Use AWS KMS `GenerateDataKey` and `Decrypt`. Requires `@aws-sdk/client-kms` when AWS_KMS_KEY_ID and AWS_REGION are set.

---

## Code layout

| File | Role |
|------|------|
| **lib/kms.ts** | KMS abstraction: `generateDataKey(keyVersion)`, `decryptDEK(encryptedDEK, keyVersion)`. Local + AWS implementations. `encryptWithDEK` / `decryptWithDEK` for DEK↔private key. |
| **lib/hot-wallet-envelope.ts** | Envelope helpers: `encryptPrivateKeyEnvelope()`, `decryptPrivateKeyEnvelope()`, `rotateEnvelopeDEK()` (re-encrypt DEK with current key version). |
| **services/hot-wallet.service.ts** | Create/replace: use envelope and store `encrypted_private_key`, `encrypted_dek`, `key_version`. Signing: if `encrypted_dek` set → envelope decrypt; else legacy decrypt. |

---

## Signing flow

1. **getSignerForChain(chainId)** loads row: `encrypted_private_key`, `encrypted_dek`, `key_version`.
2. If **encrypted_dek** is not null/empty and **key_version** is set:
   - `decryptPrivateKeyEnvelope(encrypted_private_key, encrypted_dek, key_version)`:
     - KMS decrypts `encrypted_dek` → DEK.
     - Decrypt `encrypted_private_key` with DEK → private key.
     - Zeroize DEK; return private key.
   - Use private key for signer; zeroize after use.
3. Else (legacy):
   - `decryptHotWalletKeyLegacy(encrypted_private_key)` using app `encryption.decrypt` (ENCRYPTION_KEY).
4. No private key or DEK is logged or returned to the API.

---

## Migration path (legacy → envelope)

Existing rows have **encrypted_dek** = NULL and **encrypted_private_key** = ciphertext from the old app-key-only encryption.

1. **Apply schema** (add `encrypted_dek`, `key_version`) and deploy code that supports both legacy and envelope.
2. **Run migration** (one-time) so every hot wallet gets envelope-encrypted keys:
   - **Per chain**: `migrateHotWalletToEnvelope(chainId)` in `hot-wallet.service.ts`.
   - **All**: `migrateAllHotWalletsToEnvelope()`.
3. Migration steps per row (when `encrypted_dek` IS NULL):
   - Decrypt `encrypted_private_key` with legacy `encryption.decrypt()` (app key).
   - Call `encryptPrivateKeyEnvelope(privateKey)` → new `encrypted_private_key`, `encrypted_dek`, `key_version`.
   - UPDATE row with these three; do not expose or log private key or DEK.
4. After migration, all new creates/replaces use envelope only. Legacy path remains for any row still with NULL `encrypted_dek` until you migrate it.

**Example: migrate all from a script**

```ts
import { migrateAllHotWalletsToEnvelope } from './services/hot-wallet.service.js';

const { migrated, skipped } = await migrateAllHotWalletsToEnvelope();
console.log(`Migrated ${migrated}, skipped (already envelope) ${skipped}`);
```

Or per chain (e.g. from admin or cron):

```ts
import { migrateHotWalletToEnvelope } from './services/hot-wallet.service.js';

const result = await migrateHotWalletToEnvelope('ethereum-mainnet');
// result.migrated === true if row was updated
```

---

## Key rotation (no wallet regeneration)

1. In KMS: create a new key or new version; or for local, set **KMS_KEY_VERSION** to a new value (e.g. `2`).
2. For each hot wallet row:
   - Load `encrypted_private_key`, `encrypted_dek`, `key_version`.
   - `rotateEnvelopeDEK(encrypted_private_key, encrypted_dek, key_version)`:
     - Decrypt DEK with old key version, decrypt private key with DEK.
     - Re-encrypt private key with `encryptPrivateKeyEnvelope()` (uses current **KMS_KEY_VERSION**), yielding new `encrypted_private_key`, `encrypted_dek`, `key_version`.
   - UPDATE row with the new three values.
3. Private key material and address stay the same; only the DEK and its encryption (and optionally ciphertext of the private key) are updated.

---

## Summary

| Item | Detail |
|------|--------|
| **Schema** | `encrypted_dek` (TEXT), `key_version` (VARCHAR(20)); legacy rows have NULL. |
| **Encryption** | KMS (or local) encrypts/decrypts DEK; DEK encrypts/decrypts private key (AES-256-GCM). |
| **Signing** | Envelope path if `encrypted_dek` set; else legacy app-key decrypt. |
| **Migration** | Decrypt with legacy, re-encrypt with envelope, update row; use `migrateHotWalletToEnvelope` / `migrateAllHotWalletsToEnvelope`. |
| **Rotation** | Re-encrypt DEK (and optionally private key ciphertext) with new key version; use `rotateEnvelopeDEK`. |
| **Security** | Private key and DEK stay in memory only, zeroized after use; never in API or logs. |

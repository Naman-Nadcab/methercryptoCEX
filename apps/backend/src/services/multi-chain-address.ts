/**
 * Multi-chain address derivation using TronWeb (Tron only), Solana web3.js, bitcoinjs-lib, and Polkadot keyring.
 * Deterministic derivation from a seed buffer; used for user wallets (EVM is in wallet.service via ethers).
 * TronWeb is lazy-loaded only in deriveTronAddress so BTC/Solana/Polkadot flows never load it.
 */

import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import { Keyring } from '@polkadot/keyring';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc as Parameters<typeof BIP32Factory>[0]);

export interface DerivedAddress {
  address: string;
  /** Private key or seed (hex) for storage/encryption. Do not log. */
  privateKeyHex: string;
}

/**
 * Derive 32-byte seed for a chain/index from master seed (deterministic).
 */
function deriveChainSeed(masterSeed: Buffer, chainId: string, index: number): Buffer {
  return crypto.createHmac('sha256', masterSeed).update(`${chainId}:${index}`).digest();
}

/**
 * Solana: Keypair.fromSeed(32-byte seed). Address is base58 public key.
 */
export function deriveSolanaAddress(masterSeed: Buffer, chainId: string, index: number): DerivedAddress {
  const seed32 = deriveChainSeed(masterSeed, chainId, index);
  const keypair = Keypair.fromSeed(seed32);
  const address = keypair.publicKey.toBase58();
  const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');
  return { address, privateKeyHex };
}

/**
 * Tron: address from private key via TronWeb. Private key = 32-byte hex (no 0x).
 * TronWeb is required only here so BTC/Solana/Polkadot never load it.
 * Uses official subpath tronweb/utils (fromPrivateKey) to avoid package exports errors.
 */
export function deriveTronAddress(masterSeed: Buffer, chainId: string, index: number): DerivedAddress {
  const { fromPrivateKey } = require('tronweb/utils');
  const seed32 = deriveChainSeed(masterSeed, chainId, index);
  const privateKeyHex = seed32.toString('hex');
  const address = fromPrivateKey(privateKeyHex);
  if (!address) throw new Error('Tron address derivation failed');
  return { address, privateKeyHex };
}

/**
 * Bitcoin: BIP84 native SegWit (bech32), path m/84'/0'/0'/0/index. Address starts with bc1.
 */
export function deriveBitcoinBech32Address(masterSeed: Buffer, chainId: string, index: number): DerivedAddress {
  const root = bip32.fromSeed(masterSeed);
  const path = `m/84'/0'/0'/0/${index}`;
  const child = root.derivePath(path);
  if (!child.privateKey) throw new Error('Bitcoin derivation failed');
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: child.publicKey,
    network: bitcoin.networks.bitcoin,
  });
  if (!address || !address.startsWith('bc1')) throw new Error('Bitcoin bc1 address derivation failed');
  const privateKeyHex = Buffer.from(child.privateKey).toString('hex');
  return { address, privateKeyHex };
}

/**
 * Polkadot: sr25519 keyring from 32-byte seed. SS58 format 0 = Polkadot (address starts with 1).
 */
export function derivePolkadotAddress(masterSeed: Buffer, chainId: string, index: number): DerivedAddress {
  const seed32 = deriveChainSeed(masterSeed, chainId, index);
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 0 });
  const pair = keyring.addFromSeed(seed32);
  const address = pair.address;
  const privateKeyHex = seed32.toString('hex');
  return { address, privateKeyHex };
}

/**
 * Generate a random keypair and address for a chain type (for hot wallets).
 * Uses same format as user wallets: Bitcoin bc1, Solana base58, Tron base58, Polkadot SS58.
 */
export function generateRandomAddressForChain(chainType: string): DerivedAddress {
  const type = chainType.toLowerCase();
  if (type === 'bitcoin') {
    const seed64 = crypto.randomBytes(64);
    const root = bip32.fromSeed(seed64);
    const child = root.derivePath("m/84'/0'/0'/0/0");
    if (!child.privateKey) throw new Error('Bitcoin hot wallet derivation failed');
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: child.publicKey,
      network: bitcoin.networks.bitcoin,
    });
    if (!address || !address.startsWith('bc1')) throw new Error('Bitcoin bc1 address derivation failed');
    const privateKeyHex = Buffer.from(child.privateKey).toString('hex');
    return { address, privateKeyHex };
  }
  if (type === 'solana') {
    const seed32 = crypto.randomBytes(32);
    const keypair = Keypair.fromSeed(seed32);
    const address = keypair.publicKey.toBase58();
    const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');
    return { address, privateKeyHex };
  }
  if (type === 'tron') {
    const { fromPrivateKey } = require('tronweb/utils');
    const privateKeyHex = crypto.randomBytes(32).toString('hex');
    const address = fromPrivateKey(privateKeyHex);
    if (!address) throw new Error('Tron hot wallet derivation failed');
    return { address, privateKeyHex };
  }
  if (type === 'polkadot') {
    const seed32 = crypto.randomBytes(32);
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 0 });
    const pair = keyring.addFromSeed(seed32);
    const address = pair.address;
    const privateKeyHex = seed32.toString('hex');
    return { address, privateKeyHex };
  }
  throw new Error(`Unsupported chain type for hot wallet: ${chainType}`);
}

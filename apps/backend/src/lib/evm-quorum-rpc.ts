/**
 * Multi-RPC quorum: require ≥2 matching reads (or single RPC fallback).
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { logger } from './logger.js';

const ERC20_BAL_ABI = ['function balanceOf(address) view returns (uint256)'] as const;

function tallyMajority(bals: bigint[], minAgree: number): bigint {
  const counts = new Map<string, { bal: bigint; n: number }>();
  for (const b of bals) {
    const k = b.toString();
    const cur = counts.get(k);
    if (cur) cur.n++;
    else counts.set(k, { bal: b, n: 1 });
  }
  let best: { bal: bigint; n: number } | null = null;
  for (const v of counts.values()) {
    if (!best || v.n > best.n) best = v;
  }
  if (!best || best.n < minAgree) {
    const vals = bals.map((b) => b.toString()).join(',');
    throw new Error(`EVM_QUORUM_MISMATCH: ${vals}; need ${minAgree} agreeing`);
  }
  return best.bal;
}

export async function erc20BalanceQuorum(
  contractAddress: string,
  holderAddress: string,
  rpcUrls: string[],
  minAgree = 2
): Promise<bigint> {
  const urls = [...new Set(rpcUrls.map((u) => u.trim()).filter(Boolean))];
  if (urls.length === 0) throw new Error('EVM_QUORUM_NO_RPC');
  if (urls.length === 1) {
    const p = new JsonRpcProvider(urls[0]!);
    const c = new Contract(contractAddress, ERC20_BAL_ABI, p);
    const fn = c.getFunction('balanceOf');
    if (!fn) throw new Error('EVM_QUORUM_NO_BALANCEOF');
    return BigInt((await fn(holderAddress)).toString());
  }
  const bals: bigint[] = [];
  for (const url of urls) {
    try {
      const p = new JsonRpcProvider(url);
      const c = new Contract(contractAddress, ERC20_BAL_ABI, p);
      const fn = c.getFunction('balanceOf');
      if (!fn) continue;
      bals.push(BigInt((await fn(holderAddress)).toString()));
    } catch (e) {
      logger.warn('evm_quorum: erc20 rpc failed', { url: url.slice(0, 40), error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (bals.length < minAgree) {
    throw new Error(`EVM_QUORUM_INSUFFICIENT_RPC: ${bals.length}/${urls.length}`);
  }
  return tallyMajority(bals, minAgree);
}

export async function evmNativeBalanceQuorum(address: string, rpcUrls: string[], minAgree = 2): Promise<bigint> {
  const urls = [...new Set(rpcUrls.map((u) => u.trim()).filter(Boolean))];
  if (urls.length === 0) throw new Error('EVM_QUORUM_NO_RPC');
  if (urls.length === 1) {
    const p = new JsonRpcProvider(urls[0]!);
    return p.getBalance(address);
  }

  const results: { url: string; bal: bigint; err?: string }[] = [];
  for (const url of urls) {
    try {
      const p = new JsonRpcProvider(url);
      const bal = await p.getBalance(address);
      results.push({ url, bal });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ url, bal: 0n, err: msg });
      logger.warn('evm_quorum: rpc failed', { url: url.slice(0, 40), error: msg });
    }
  }

  const ok = results.filter((r) => r.err == null);
  if (ok.length < minAgree) {
    throw new Error(`EVM_QUORUM_INSUFFICIENT_RPC: ${ok.length}/${urls.length} OK, need ${minAgree}`);
  }

  return tallyMajority(
    ok.map((r) => r.bal),
    minAgree
  );
}

export async function evmTxReceiptStatusQuorum(txHash: string, rpcUrls: string[], minAgree = 2): Promise<number | null> {
  const urls = [...new Set(rpcUrls.map((u) => u.trim()).filter(Boolean))];
  if (urls.length === 0) throw new Error('EVM_QUORUM_NO_RPC');
  if (urls.length === 1) {
    const p = new JsonRpcProvider(urls[0]!);
    const r = await p.getTransactionReceipt(txHash);
    return r?.status ?? null;
  }

  const statuses: (number | null)[] = [];
  for (const url of urls) {
    try {
      const p = new JsonRpcProvider(url);
      const r = await p.getTransactionReceipt(txHash);
      statuses.push(r?.status ?? null);
    } catch {
      statuses.push(null);
    }
  }
  const defined = statuses.filter((s): s is number => s !== null);
  if (defined.length < minAgree) {
    throw new Error('EVM_QUORUM_RECEIPT_INSUFFICIENT');
  }
  const counts = new Map<number, number>();
  for (const s of defined) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: { s: number; n: number } | null = null;
  for (const [s, n] of counts) {
    if (!best || n > best.n) best = { s, n };
  }
  if (!best || best.n < minAgree) {
    throw new Error('EVM_QUORUM_RECEIPT_MISMATCH');
  }
  return best.s;
}
